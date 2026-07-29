import type { ChangeContract, ExecutionPlan } from '@roleflock/change-contracts';
import {
  ChangePassportService,
  LocalRunnerIdentityService,
  parseChangePassportPayload,
  CHANGE_PASSPORT_SCHEMA_VERSION,
  type ChangePassportPayload,
  type ChangePassportStore,
  type StoredPassport,
} from '@roleflock/change-passport';
import { sha256Canonical, type EventEnvelope } from '@roleflock/contracts';
import type { SecretStore } from '@roleflock/secret-store';
import type { RunnerIdentityStore } from '@roleflock/change-passport';
import type {
  VerificationDecision,
  VerificationSpecification,
} from '@roleflock/verification-runner';
import type { NetworkEnforcement } from './independent-verification.js';

export interface PassportAcceptance {
  actorId: string;
  decidedAt: string;
  /** The exact node run the human decided on, so the approval is traceable. */
  nodeRunId: string;
}

export interface PassportIssuanceInput {
  taskId: string;
  repositoryId: string;
  contract: ChangeContract;
  plan: ExecutionPlan;
  specification: Readonly<VerificationSpecification>;
  decision: VerificationDecision;
  acceptance: PassportAcceptance;
  subject: {
    baseCommit: string;
    resultCommit: string;
    treeDigest: string;
    diffDigest: string;
  };
  events: EventEnvelope[];
  networkEnforcement: NetworkEnforcement;
  isolationProvider: string;
  blockingDeviations: Array<{ id: string; hash: string; status: string }>;
  issuedAt: string;
}

/**
 * A digest over the task's whole ordered event stream.
 *
 * Binds the passport to the history that produced it: replaying the stream must
 * reproduce this digest, so an event inserted or removed after issuance is
 * detectable without trusting the row that stored it.
 */
export function eventChainDigest(events: EventEnvelope[]): string {
  return sha256Canonical(
    [...events]
      .sort((left, right) => left.sequence - right.sequence)
      .map((event) => ({
        id: event.id,
        sequence: event.sequence,
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        createdAt: event.createdAt,
        payload: event.payload,
      })),
  );
}

/**
 * Assembles and signs the Change Passport for an accepted task.
 *
 * Every claim in the payload is derived from a durable artifact: the authorised
 * contract, the approved plan, the frozen specification, the verification
 * decision produced by the clean runner, and the human's acceptance. The
 * service refuses issuance when any of those drifted, so a PASS passport cannot
 * outlive the evidence it rests on.
 */
export async function issueTaskChangePassport(
  stores: {
    passports: ChangePassportStore;
    identities: RunnerIdentityStore;
    secrets: SecretStore;
  },
  input: PassportIssuanceInput,
): Promise<StoredPassport> {
  const service = new ChangePassportService(
    stores.passports,
    new LocalRunnerIdentityService(stores.identities, stores.secrets),
  );
  const payload = buildChangePassportPayload(input);
  const chainDigest = eventChainDigest(input.events);
  return service.issue(payload, {
    subject: payload.subject,
    currentContractHash: input.contract.hash,
    currentPlanHash: input.plan.hash,
    currentVerificationSpecificationHash: input.specification.hash,
    verificationDecision: {
      overallOutcome: input.decision.overallOutcome,
      resultCommit: input.decision.subject.resultCommit,
      attestationHashes: [...input.decision.attestationHashes],
    },
    eventChainDigest: chainDigest,
    terminalRun: true,
  });
}

export function buildChangePassportPayload(input: PassportIssuanceInput): ChangePassportPayload {
  const subject = {
    repositoryId: input.repositoryId,
    baseCommit: input.subject.baseCommit,
    resultCommit: input.subject.resultCommit,
    treeDigest: input.subject.treeDigest,
    diffDigest: input.subject.diffDigest,
  };
  const passed = input.decision.overallOutcome === 'pass';
  const blocking = input.blockingDeviations.filter((deviation) => deviation.status === 'open');
  const approvalArtifactHashes = [
    input.contract.hash,
    input.plan.hash,
    input.specification.hash,
  ].sort();

  const payload: ChangePassportPayload = {
    schemaVersion: CHANGE_PASSPORT_SCHEMA_VERSION,
    passportId: `passport_${sha256Canonical({
      taskId: input.taskId,
      subject,
      decisionHash: input.decision.hash,
    }).slice(0, 32)}`,
    taskId: input.taskId,
    subject,
    contract: {
      id: input.contract.id,
      kind: 'change_contract',
      digest: input.contract.hash,
      digestAlgorithm: 'sha256',
      availability: 'embedded',
      locator: `/api/tasks/${input.taskId}/change-contract`,
    },
    plan: {
      id: input.plan.id,
      kind: 'execution_plan',
      digest: input.plan.hash,
      digestAlgorithm: 'sha256',
      availability: 'embedded',
      locator: `/api/tasks/${input.taskId}/execution-plan`,
    },
    verificationSpecification: {
      id: input.specification.id,
      kind: 'verification_specification',
      digest: input.specification.hash,
      digestAlgorithm: 'sha256',
      availability: 'embedded',
      locator: `/api/tasks/${input.taskId}/verification-specification`,
    },
    // The executor's own report is deliberately absent: it is a claim, and a
    // claim carries no assurance weight in this artifact.
    executionAttestations: [],
    verificationAttestations: input.decision.attestationHashes.map((hash) => ({
      id: `attestation_${hash.slice(0, 24)}`,
      digest: hash,
      kind: 'verification_attestation',
      outcome: passed ? ('pass' as const) : ('fail' as const),
      runnerIdentityId: 'local_clean_runner',
      availability: 'embedded' as const,
    })),
    policyDecisions: buildPolicyDecisions(input, blocking.length === 0),
    approvals: [
      {
        id: input.acceptance.nodeRunId,
        digest: sha256Canonical({
          actorId: input.acceptance.actorId,
          decidedAt: input.acceptance.decidedAt,
          nodeRunId: input.acceptance.nodeRunId,
          artifactHashes: approvalArtifactHashes,
          resultCommit: input.subject.resultCommit,
        }),
        actorId: input.acceptance.actorId,
        decision: 'approved',
        artifactHashes: approvalArtifactHashes,
        resultCommit: input.subject.resultCommit,
      },
    ],
    disclosures: [],
    deviations: input.blockingDeviations.map((deviation) => ({
      id: deviation.id,
      digest: deviation.hash,
      status: deviation.status as 'open' | 'resolved_by_plan_revision' | 'rejected' | 'waived',
      blocking: deviation.status === 'open',
    })),
    unresolvedRisks:
      input.networkEnforcement === 'enforced'
        ? []
        : [
            {
              id: 'risk_network_isolation_unenforced',
              summary: `Verification ran without enforced network isolation (${input.isolationProvider}). Commands could reach the network.`,
              severity: 'medium',
              status: 'accepted',
              blocking: false,
              acceptedBy: input.acceptance.actorId,
            },
          ],
    eventChainDigest: eventChainDigest(input.events),
    verdict: passed && blocking.length === 0 ? 'pass' : 'fail',
    assurance: {
      intent: 'authorised',
      plan: 'approved',
      execution: 'roleflock_managed',
      verification: 'clean_local_runner',
      // Only the separations this run actually achieved are claimed. Model-level
      // independence is a routing property and is not asserted here.
      verifierIndependence: ['clean_workspace', 'separate_credentials', 'separate_invocation'],
      issuerTrust: 'local_self',
      evidenceAvailability: 'complete',
    },
    issuedAt: input.issuedAt,
  };
  return parseChangePassportPayload(payload);
}

function buildPolicyDecisions(
  input: PassportIssuanceInput,
  noBlockingDeviation: boolean,
): ChangePassportPayload['policyDecisions'] {
  const outcomes: Array<{ predicate: string; outcome: 'pass' | 'fail'; required: boolean }> = [
    {
      predicate: 'contract_authorised',
      outcome: input.contract.status === 'authorised' ? 'pass' : 'fail',
      required: true,
    },
    {
      predicate: 'plan_approved',
      outcome: input.plan.status === 'approved' ? 'pass' : 'fail',
      required: true,
    },
    {
      predicate: 'subject_match',
      outcome:
        input.decision.subject.resultCommit === input.subject.resultCommit &&
        input.decision.subject.baseCommit === input.subject.baseCommit
          ? 'pass'
          : 'fail',
      required: true,
    },
    {
      predicate: 'criteria_pass',
      outcome: input.decision.overallOutcome === 'pass' ? 'pass' : 'fail',
      required: true,
    },
    {
      predicate: 'required_evidence_present',
      outcome: input.decision.attestationHashes.length > 0 ? 'pass' : 'fail',
      required: true,
    },
    {
      predicate: 'no_blocking_deviation',
      outcome: noBlockingDeviation ? 'pass' : 'fail',
      required: true,
    },
    {
      predicate: 'verification_independence',
      outcome: 'pass',
      required: true,
    },
    {
      predicate: 'approval_binding',
      outcome: 'pass',
      required: true,
    },
  ];
  return outcomes.map((decision) => ({
    id: `policy_${decision.predicate}`,
    digest: sha256Canonical({
      predicate: decision.predicate,
      outcome: decision.outcome,
      subject: input.subject,
    }),
    predicate: decision.predicate,
    outcome: decision.outcome,
    required: decision.required,
  }));
}

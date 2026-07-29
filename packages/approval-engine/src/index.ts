import { createId, sha256Canonical } from '@roleflock/contracts';
import type { ApprovalGrant, ConfirmationRequest, StructuredAction } from '@roleflock/contracts';

export function actionFingerprint(action: StructuredAction): string {
  return sha256Canonical({
    kind: action.kind,
    verb: action.verb,
    target: action.target,
    paths: [...(action.paths ?? [])].sort(),
    command: action.command,
    args: action.args ?? [],
    destination: action.destination,
    sideEffectClass: action.sideEffectClass,
    metadata: action.metadata,
  });
}

export function createConfirmationRequest(
  input: Omit<ConfirmationRequest, 'id' | 'fingerprint' | 'status' | 'createdAt'> & {
    createdAt?: string;
  },
): ConfirmationRequest {
  return {
    ...input,
    id: createId('confirmation'),
    fingerprint: actionFingerprint(input.exactAction),
    status: 'pending',
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

const SENSITIVE = new Set([
  'network_access',
  'database_change',
  'external_side_effect',
  'dependency_change',
  'policy_exception',
]);
export function mayReuseApproval(
  request: Pick<ConfirmationRequest, 'requestType' | 'fingerprint'>,
  grant: ApprovalGrant,
  now = new Date(),
): boolean {
  if (SENSITIVE.has(request.requestType)) return false;
  if (
    grant.revokedAt ||
    new Date(grant.expiresAt) <= now ||
    grant.applicationsUsed >= (grant.maximumApplications ?? Infinity)
  )
    return false;
  if (grant.scope === 'exact_fingerprint' && grant.fingerprint !== request.fingerprint)
    return false;
  if (grant.scope === 'task_request_type' && !grant.requestTypes?.includes(request.requestType))
    return false;
  return true;
}

export function matchingGrant(
  request: Pick<ConfirmationRequest, 'requestType' | 'fingerprint' | 'riskClass'>,
  grants: ApprovalGrant[],
  now?: Date,
): ApprovalGrant | undefined {
  return grants.find(
    (grant) =>
      mayReuseApproval(request, grant, now) &&
      riskRank(request.riskClass) <= riskRank(grant.maximumRisk),
  );
}
function riskRank(risk: string) {
  return ['low', 'medium', 'high', 'critical'].indexOf(risk);
}

export interface MultiPartyApprovalPolicy {
  id: string;
  artifactDigest: string;
  quorum: number;
  requiredRoles: string[];
  vetoRoles: string[];
}

export interface PartyApprovalDecision {
  actorId: string;
  role: string;
  decision: 'approved' | 'rejected';
  artifactDigest: string;
  signatureDigest: string;
}

export function evaluateMultiPartyApproval(
  policy: MultiPartyApprovalPolicy,
  decisions: readonly PartyApprovalDecision[],
): {
  outcome: 'approved' | 'rejected' | 'pending';
  approvals: number;
  missingRoles: string[];
  reason: string;
} {
  const relevant = decisions.filter(
    (decision) => decision.artifactDigest === policy.artifactDigest,
  );
  const unique = new Map(relevant.map((decision) => [decision.actorId, decision]));
  const values = [...unique.values()];
  const veto = values.find(
    (decision) => decision.decision === 'rejected' && policy.vetoRoles.includes(decision.role),
  );
  if (veto) {
    return {
      outcome: 'rejected',
      approvals: values.filter((decision) => decision.decision === 'approved').length,
      missingRoles: [],
      reason: `Veto by ${veto.role} actor ${veto.actorId}.`,
    };
  }
  const approvals = values.filter((decision) => decision.decision === 'approved');
  const approvedRoles = new Set(approvals.map((decision) => decision.role));
  const missingRoles = policy.requiredRoles.filter((role) => !approvedRoles.has(role));
  if (approvals.length >= policy.quorum && missingRoles.length === 0) {
    return {
      outcome: 'approved',
      approvals: approvals.length,
      missingRoles,
      reason: 'Quorum and all required roles are satisfied.',
    };
  }
  return {
    outcome: 'pending',
    approvals: approvals.length,
    missingRoles,
    reason: 'Approval quorum or required role coverage is incomplete.',
  };
}

export interface TransparencyEntry {
  sequence: number;
  previousHash?: string;
  entryType: string;
  subjectId: string;
  payloadDigest: string;
  occurredAt: string;
  hash: string;
}

export function appendTransparencyEntry(
  previous: TransparencyEntry | undefined,
  input: Omit<TransparencyEntry, 'sequence' | 'previousHash' | 'hash'>,
): TransparencyEntry {
  const unsigned = {
    sequence: previous ? previous.sequence + 1 : 0,
    ...(previous ? { previousHash: previous.hash } : {}),
    ...input,
  };
  return { ...unsigned, hash: sha256Canonical(unsigned) };
}

export function verifyTransparencyLog(entries: readonly TransparencyEntry[]): boolean {
  let previous: TransparencyEntry | undefined;
  for (const entry of entries) {
    const expected = appendTransparencyEntry(previous, {
      entryType: entry.entryType,
      subjectId: entry.subjectId,
      payloadDigest: entry.payloadDigest,
      occurredAt: entry.occurredAt,
    });
    if (sha256Canonical(entry) !== sha256Canonical(expected)) return false;
    previous = entry;
  }
  return true;
}

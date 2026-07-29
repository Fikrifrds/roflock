import { sha256Canonical } from '@roleflock/contracts';
import {
  UnhashedVerificationAttestationSchema,
  UnhashedVerificationDecisionSchema,
  VerificationAttestationSchema,
  VerificationDecisionSchema,
} from '@roleflock/verification-runner';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, migrate, type SqliteDb } from './client.js';
import { VerificationResultRepository } from './repositories/verification-result-repository.js';

let db: SqliteDb | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

describe('VerificationResultRepository', () => {
  it('persists a complete immutable decision bundle', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    const repository = new VerificationResultRepository(db);
    const result = fixture();

    repository.create(result);
    expect(repository.getLatest('task_1')).toEqual(result);
    expect(() =>
      db!
        .prepare(`UPDATE verification_runs SET overall_outcome = 'pass' WHERE id = ?`)
        .run(result.decision.id),
    ).toThrow(/immutable/);
    expect(() =>
      db!
        .prepare(`DELETE FROM verification_attestations WHERE id = ?`)
        .run(result.attestations[0]!.id),
    ).toThrow(/immutable/);
  });

  it('rejects incomplete attestation sets', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    const repository = new VerificationResultRepository(db);
    const result = fixture();
    expect(() => repository.create({ decision: result.decision, attestations: [] })).toThrow(
      /attestation set is incomplete/,
    );
  });
});

function fixture() {
  const subject = {
    taskId: 'task_1',
    repositoryId: 'repository_1',
    contractHash: 'a'.repeat(64),
    planId: 'plan_1',
    planHash: 'b'.repeat(64),
    verificationSpecificationId: 'verification_1',
    verificationSpecificationHash: 'c'.repeat(64),
    baseCommit: '1'.repeat(40),
    resultCommit: '2'.repeat(40),
  };
  const unhashedAttestation = UnhashedVerificationAttestationSchema.parse({
    id: 'attestation_1',
    subject,
    checkId: 'CHECK-1',
    criterionIds: ['AC-1'],
    commandDigest: 'd'.repeat(64),
    environmentDigest: 'e'.repeat(64),
    networkPolicyDigest: 'f'.repeat(64),
    mutationAnalysisDigest: '0'.repeat(64),
    startedAt: '2026-07-28T10:00:00.000Z',
    completedAt: '2026-07-28T10:00:01.000Z',
    durationMs: 1_000,
    outcome: 'pass',
    exitCode: 0,
    logDigests: ['3'.repeat(64), '4'.repeat(64)],
    artifactDigests: [],
    runnerIdentity: { runnerId: 'runner_1', trustLevel: 'clean_local_runner' },
  });
  const attestation = VerificationAttestationSchema.parse({
    ...unhashedAttestation,
    hashAlgorithm: 'sha256',
    hash: sha256Canonical(unhashedAttestation),
  });
  const unhashedDecision = UnhashedVerificationDecisionSchema.parse({
    id: 'decision_1',
    taskId: 'task_1',
    subject,
    verdicts: [
      {
        criterionId: 'AC-1',
        outcome: 'pass',
        evidenceRefs: ['attestation_1'],
        findingIds: [],
        explanation: 'Independent evidence passed.',
      },
    ],
    findings: [],
    attestationHashes: [attestation.hash],
    mutationAnalysisDigest: '0'.repeat(64),
    ignoredExecutorClaimIds: [],
    overallOutcome: 'pass',
    createdAt: '2026-07-28T10:00:01.000Z',
  });
  const decision = VerificationDecisionSchema.parse({
    ...unhashedDecision,
    hashAlgorithm: 'sha256',
    hash: sha256Canonical(unhashedDecision),
  });
  return { decision, attestations: [attestation] };
}

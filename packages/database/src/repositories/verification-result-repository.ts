import {
  VerificationAttestationSchema,
  VerificationDecisionSchema,
  verifyVerificationAttestation,
  verifyVerificationDecision,
  type VerificationAttestation,
  type VerificationDecision,
} from '@roleflock/verification-runner';
import type { SqliteDb } from '../client.js';

export interface StoredVerificationResult {
  decision: VerificationDecision;
  attestations: VerificationAttestation[];
}

export class VerificationResultRepository {
  constructor(private readonly db: SqliteDb) {}

  create(result: StoredVerificationResult): StoredVerificationResult {
    assertResult(result);
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO verification_runs (
             id, task_id, result_commit, specification_hash, mutation_analysis_digest,
             overall_outcome, decision_hash, decision_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          result.decision.id,
          result.decision.taskId,
          result.decision.subject.resultCommit,
          result.decision.subject.verificationSpecificationHash,
          result.decision.mutationAnalysisDigest,
          result.decision.overallOutcome,
          result.decision.hash,
          JSON.stringify(result.decision),
          result.decision.createdAt,
        );
      const attestationStatement = this.db.prepare(
        `INSERT INTO verification_attestations (
           id, verification_run_id, task_id, check_id, attestation_hash, artifact_json
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const attestation of result.attestations) {
        attestationStatement.run(
          attestation.id,
          result.decision.id,
          result.decision.taskId,
          attestation.checkId,
          attestation.hash,
          JSON.stringify(attestation),
        );
      }
      const verdictStatement = this.db.prepare(
        `INSERT INTO criterion_verdicts (
           verification_run_id, criterion_id, outcome, verdict_json
         ) VALUES (?, ?, ?, ?)`,
      );
      for (const verdict of result.decision.verdicts) {
        verdictStatement.run(
          result.decision.id,
          verdict.criterionId,
          verdict.outcome,
          JSON.stringify(verdict),
        );
      }
    });
    insert();
    return result;
  }

  getLatest(taskId: string): StoredVerificationResult | undefined {
    const row = this.db
      .prepare(
        `SELECT id, decision_json
         FROM verification_runs
         WHERE task_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(taskId) as { id: string; decision_json: string } | undefined;
    if (!row) return undefined;
    const decision = VerificationDecisionSchema.parse(JSON.parse(row.decision_json));
    const attestations = (
      this.db
        .prepare(
          `SELECT artifact_json
           FROM verification_attestations
           WHERE verification_run_id = ?
           ORDER BY id`,
        )
        .all(row.id) as Array<{ artifact_json: string }>
    ).map((item) => VerificationAttestationSchema.parse(JSON.parse(item.artifact_json)));
    const result = { decision, attestations };
    assertResult(result);
    return result;
  }
}

function assertResult(result: StoredVerificationResult): void {
  VerificationDecisionSchema.parse(result.decision);
  if (!verifyVerificationDecision(result.decision)) {
    throw new Error('Verification decision hash is invalid');
  }
  for (const attestation of result.attestations) {
    VerificationAttestationSchema.parse(attestation);
    if (!verifyVerificationAttestation(attestation)) {
      throw new Error(`Verification attestation hash is invalid: ${attestation.id}`);
    }
    if (
      attestation.subject.taskId !== result.decision.taskId ||
      attestation.subject.resultCommit !== result.decision.subject.resultCommit
    ) {
      throw new Error(`Verification attestation has a mismatched subject: ${attestation.id}`);
    }
  }
  const actualHashes = result.attestations.map((item) => item.hash).sort();
  if (
    JSON.stringify(actualHashes) !== JSON.stringify([...result.decision.attestationHashes].sort())
  ) {
    throw new Error('Verification decision attestation set is incomplete');
  }
}

import {
  type NormalizedTaskClass,
  verifyOutcomeObservation,
  type SealedOutcomeObservation,
} from '@roleflock/role-recommender';
import type { SqliteDb } from '../client.js';

export class OutcomeObservationRepository {
  constructor(private readonly db: SqliteDb) {}

  ingest(value: SealedOutcomeObservation, createdAt = new Date().toISOString()) {
    if (!verifyOutcomeObservation(value)) throw new Error('Outcome observation digest is invalid');
    const replay = this.get(value.observationId);
    if (replay) {
      if (replay.observationDigest !== value.observationDigest) {
        throw new Error('Outcome observation id was reused with different content');
      }
      return { status: 'replayed' as const, observation: replay };
    }
    this.db
      .prepare(
        `INSERT INTO outcome_observations (
           observation_id, task_id, task_type, risk, repository_size_bucket, role_id,
           provider_id, model_id, model_family, profile_version, routing_policy_version,
           status, excluded, observation_digest, observation_json, observed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.observationId,
        value.taskId,
        value.taskClass.taskType,
        value.taskClass.risk,
        value.taskClass.repositorySizeBucket,
        value.roleAssignment.roleId,
        value.roleAssignment.providerId,
        value.roleAssignment.modelId,
        value.roleAssignment.modelFamily ?? null,
        value.roleAssignment.profileVersion,
        value.roleAssignment.routingPolicyVersion,
        value.outcome.status,
        value.excluded ? 1 : 0,
        value.observationDigest,
        JSON.stringify(value),
        value.observedAt,
        createdAt,
      );
    return { status: 'accepted' as const, observation: value };
  }

  get(observationId: string): SealedOutcomeObservation | undefined {
    const row = this.db
      .prepare(`SELECT observation_json FROM outcome_observations WHERE observation_id = ?`)
      .get(observationId) as { observation_json: string } | undefined;
    return row ? (JSON.parse(row.observation_json) as SealedOutcomeObservation) : undefined;
  }

  listByTask(taskId: string): SealedOutcomeObservation[] {
    return (
      this.db
        .prepare(
          `SELECT observation_json FROM outcome_observations
           WHERE task_id = ? ORDER BY observed_at ASC`,
        )
        .all(taskId) as Array<{ observation_json: string }>
    ).map((row) => JSON.parse(row.observation_json) as SealedOutcomeObservation);
  }

  classify(
    observationId: string,
    classification: NormalizedTaskClass,
    createdAt = new Date().toISOString(),
  ): NormalizedTaskClass {
    if (!this.get(observationId)) throw new Error(`Outcome observation not found: ${observationId}`);
    this.db
      .prepare(
        `INSERT INTO outcome_task_classes (
           observation_id, normalizer_version, class_key, confidence,
           classification_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        observationId,
        classification.normalizerVersion,
        classification.key,
        classification.confidence,
        JSON.stringify(classification),
        createdAt,
      );
    return classification;
  }

  listCohort(classKey: string, minimumConfidence = 0.8): SealedOutcomeObservation[] {
    return (
      this.db
        .prepare(
          `SELECT o.observation_json
           FROM outcome_observations o
           JOIN outcome_task_classes c ON c.observation_id = o.observation_id
           WHERE c.class_key = ? AND c.confidence >= ? AND o.excluded = 0
           ORDER BY o.observed_at ASC`,
        )
        .all(classKey, minimumConfidence) as Array<{ observation_json: string }>
    ).map((row) => JSON.parse(row.observation_json) as SealedOutcomeObservation);
  }
}

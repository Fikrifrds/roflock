import { randomUUID } from 'node:crypto';
import { sha256Canonical } from '@roleflock/contracts';
import {
  ModelCapabilityProfileSchema,
  RoleRecommendationSchema,
  type ModelCapabilityProfile,
  type RecommendedRole,
  type RoleRecommendation,
} from '@roleflock/role-recommender';
import type { SqliteDb } from '../client.js';

export interface RecommendationRosterEntry {
  role: RecommendedRole;
  providerId: string;
  modelId: string;
  effort: string;
}

export interface RoleRecommendationAction {
  id: string;
  recommendationId: string;
  revision: number;
  action: 'applied' | 'overridden';
  actor: string;
  role?: RecommendedRole;
  providerId?: string;
  modelId?: string;
  reason?: string;
  roster: RecommendationRosterEntry[];
  idempotencyKey: string;
  requestHash: string;
  createdAt: string;
}

export interface StoredRoleRecommendation {
  recommendation: RoleRecommendation;
  actions: RoleRecommendationAction[];
  revision: number;
}

export class RecommendationVersionConflictError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Recommendation revision conflict: expected ${expected}, received ${actual}`);
    this.name = 'RecommendationVersionConflictError';
  }
}

export class RecommendationIdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used with different recommendation action input');
    this.name = 'RecommendationIdempotencyConflictError';
  }
}

export class RoleRecommendationRepository {
  constructor(private readonly db: SqliteDb) {}

  recordProfiles(
    profiles: readonly ModelCapabilityProfile[],
    bundleVersion: string,
    recordedAt: string,
  ): void {
    const find = this.db.prepare(
      `SELECT profile_digest FROM model_capability_profiles
       WHERE provider_id = ? AND model_id = ? AND profile_version = ?`,
    );
    const insert = this.db.prepare(
      `INSERT INTO model_capability_profiles
        (provider_id, model_id, profile_version, bundle_version, profile_digest,
         profile_json, effective_at, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      for (const input of profiles) {
        const profile = ModelCapabilityProfileSchema.parse(input);
        const digest = sha256Canonical(profile);
        const existing = find.get(profile.providerId, profile.modelId, profile.profileVersion) as
          { profile_digest: string } | undefined;
        if (existing) {
          if (existing.profile_digest !== digest) {
            throw new Error(
              `Model capability profile version was reused with different content: ${profile.providerId}/${profile.modelId}@${profile.profileVersion}`,
            );
          }
          continue;
        }
        insert.run(
          profile.providerId,
          profile.modelId,
          profile.profileVersion,
          bundleVersion,
          digest,
          JSON.stringify(profile),
          profile.effectiveAt,
          recordedAt,
        );
      }
    })();
  }

  create(input: RoleRecommendation): StoredRoleRecommendation {
    const recommendation = RoleRecommendationSchema.parse(input);
    const insertRecommendation = this.db.prepare(
      `INSERT INTO role_recommendations
        (id, task_id, recommendation_version, risk, profile_bundle_version,
         profile_bundle_digest, scoring_version, input_hash, complete, snapshot_json, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertCandidate = this.db.prepare(
      `INSERT INTO role_recommendation_candidates
        (recommendation_id, role, provider_id, model_id, rank, selected, fallback,
         eligible, candidate_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      insertRecommendation.run(
        recommendation.id,
        recommendation.taskId,
        recommendation.recommendationVersion,
        recommendation.risk,
        recommendation.profileBundleVersion,
        recommendation.profileBundleDigest,
        recommendation.scoringVersion,
        recommendation.inputHash,
        recommendation.complete ? 1 : 0,
        JSON.stringify(recommendation),
        recommendation.generatedAt,
      );
      for (const candidate of recommendation.candidates) {
        insertCandidate.run(
          recommendation.id,
          candidate.role,
          candidate.providerId,
          candidate.modelId,
          candidate.rank ?? null,
          candidate.selected ? 1 : 0,
          candidate.fallback ? 1 : 0,
          candidate.eligible ? 1 : 0,
          JSON.stringify(candidate),
        );
      }
    })();
    return { recommendation, actions: [], revision: 0 };
  }

  get(id: string): StoredRoleRecommendation | undefined {
    const row = this.db
      .prepare('SELECT snapshot_json FROM role_recommendations WHERE id = ?')
      .get(id) as { snapshot_json: string } | undefined;
    if (!row) return undefined;
    const recommendation = RoleRecommendationSchema.parse(JSON.parse(row.snapshot_json));
    const actions = this.listActions(id);
    return {
      recommendation,
      actions,
      revision: actions.at(-1)?.revision ?? 0,
    };
  }

  getLatestByTask(taskId: string): StoredRoleRecommendation | undefined {
    const row = this.db
      .prepare(
        `SELECT id FROM role_recommendations
         WHERE task_id = ? ORDER BY generated_at DESC, id DESC LIMIT 1`,
      )
      .get(taskId) as { id: string } | undefined;
    return row ? this.get(row.id) : undefined;
  }

  findActionByIdempotency(
    recommendationId: string,
    idempotencyKey: string,
  ): RoleRecommendationAction | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM role_recommendation_actions
         WHERE recommendation_id = ? AND idempotency_key = ?`,
      )
      .get(recommendationId, idempotencyKey) as ActionRow | undefined;
    return row ? mapAction(row) : undefined;
  }

  recordAction(input: {
    recommendationId: string;
    expectedRevision: number;
    action: RoleRecommendationAction['action'];
    actor: string;
    role?: RecommendedRole;
    providerId?: string;
    modelId?: string;
    reason?: string;
    roster: RecommendationRosterEntry[];
    idempotencyKey: string;
    createdAt: string;
  }): RoleRecommendationAction {
    if (!input.idempotencyKey.trim()) throw new Error('idempotencyKey is required');
    if (input.action === 'overridden' && (!input.role || !input.reason?.trim())) {
      throw new Error('Override actions require a role and reason');
    }
    const requestHash = sha256Canonical({
      recommendationId: input.recommendationId,
      action: input.action,
      actor: input.actor,
      role: input.role,
      providerId: input.providerId,
      modelId: input.modelId,
      reason: input.reason?.trim(),
      roster: input.roster,
    });
    const existing = this.findActionByIdempotency(input.recommendationId, input.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new RecommendationIdempotencyConflictError();
      }
      return existing;
    }
    if (!this.get(input.recommendationId)) {
      throw new Error(`Role recommendation not found: ${input.recommendationId}`);
    }
    const currentRevision = this.currentRevision(input.recommendationId);
    if (currentRevision !== input.expectedRevision) {
      throw new RecommendationVersionConflictError(input.expectedRevision, currentRevision);
    }
    const action: RoleRecommendationAction = {
      id: randomUUID(),
      recommendationId: input.recommendationId,
      revision: currentRevision + 1,
      action: input.action,
      actor: input.actor,
      ...(input.role ? { role: input.role } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      roster: input.roster,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      createdAt: input.createdAt,
    };
    this.db
      .prepare(
        `INSERT INTO role_recommendation_actions
          (id, recommendation_id, revision, action, actor, role, provider_id, model_id,
           reason, roster_json, idempotency_key, request_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        action.id,
        action.recommendationId,
        action.revision,
        action.action,
        action.actor,
        action.role ?? null,
        action.providerId ?? null,
        action.modelId ?? null,
        action.reason ?? null,
        JSON.stringify(action.roster),
        action.idempotencyKey,
        action.requestHash,
        action.createdAt,
      );
    return action;
  }

  private currentRevision(recommendationId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(revision), 0) AS revision
         FROM role_recommendation_actions WHERE recommendation_id = ?`,
      )
      .get(recommendationId) as { revision: number };
    return row.revision;
  }

  private listActions(recommendationId: string): RoleRecommendationAction[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM role_recommendation_actions
           WHERE recommendation_id = ? ORDER BY revision ASC`,
        )
        .all(recommendationId) as ActionRow[]
    ).map(mapAction);
  }
}

interface ActionRow {
  id: string;
  recommendation_id: string;
  revision: number;
  action: RoleRecommendationAction['action'];
  actor: string;
  role: RecommendedRole | null;
  provider_id: string | null;
  model_id: string | null;
  reason: string | null;
  roster_json: string;
  idempotency_key: string;
  request_hash: string;
  created_at: string;
}

function mapAction(row: ActionRow): RoleRecommendationAction {
  return {
    id: row.id,
    recommendationId: row.recommendation_id,
    revision: row.revision,
    action: row.action,
    actor: row.actor,
    ...(row.role ? { role: row.role } : {}),
    ...(row.provider_id ? { providerId: row.provider_id } : {}),
    ...(row.model_id ? { modelId: row.model_id } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    roster: JSON.parse(row.roster_json) as RecommendationRosterEntry[],
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    createdAt: row.created_at,
  };
}

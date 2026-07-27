import { randomUUID } from 'node:crypto';
import type { SqliteDb } from '../client.js';

export interface RoleCandidate {
  id: string;
  role: string;
  position: number;
  providerConnectionId: string;
  modelId: string;
  effort?: string;
  enabled: boolean;
}

export interface RoleCandidateInput {
  providerConnectionId: string;
  modelId: string;
  effort?: string;
  enabled?: boolean;
}

interface Row {
  id: string;
  role: string;
  position: number;
  provider_connection_id: string;
  model_id: string;
  effort: string | null;
  enabled: number;
}

function toCandidate(row: Row): RoleCandidate {
  return {
    id: row.id,
    role: row.role,
    position: row.position,
    providerConnectionId: row.provider_connection_id,
    modelId: row.model_id,
    effort: row.effort ?? undefined,
    enabled: row.enabled === 1,
  };
}

/**
 * The ordered provider+model preference list for each role.
 *
 * Order is the whole point: position 0 is what the user wants, and the rest is
 * what the router is allowed to reach for when that candidate cannot serve —
 * an exhausted quota being the case this exists for.
 */
export class RoleAssignmentRepository {
  constructor(private readonly db: SqliteDb) {}

  listAll(): RoleCandidate[] {
    return (
      this.db
        .prepare('SELECT * FROM role_assignments ORDER BY role ASC, position ASC')
        .all() as Row[]
    ).map(toCandidate);
  }

  listForRole(role: string): RoleCandidate[] {
    return (
      this.db
        .prepare('SELECT * FROM role_assignments WHERE role = ? ORDER BY position ASC')
        .all(role) as Row[]
    ).map(toCandidate);
  }

  hasAny(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM role_assignments').get() as {
      count: number;
    };
    return row.count > 0;
  }

  /**
   * Replaces a role's list wholesale.
   *
   * Delete-then-insert inside one transaction, because `(role, position)` is
   * unique: reordering in place would collide with the rows being moved past.
   */
  replaceRole(role: string, candidates: RoleCandidateInput[], at: string): RoleCandidate[] {
    const remove = this.db.prepare('DELETE FROM role_assignments WHERE role = ?');
    const insert = this.db.prepare(
      `INSERT INTO role_assignments
         (id, role, position, provider_connection_id, model_id, effort, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.db.transaction(() => {
      remove.run(role);
      candidates.forEach((candidate, position) => {
        insert.run(
          randomUUID(),
          role,
          position,
          candidate.providerConnectionId,
          candidate.modelId,
          candidate.effort ?? null,
          candidate.enabled === false ? 0 : 1,
          at,
          at,
        );
      });
    })();

    return this.listForRole(role);
  }
}

export interface ProviderCooldown {
  providerConnectionId: string;
  modelId: string;
  reason: string;
  detail?: string;
  startedAt: string;
  until: string;
}

interface CooldownRow {
  provider_connection_id: string;
  model_id: string;
  reason: string;
  detail: string | null;
  started_at: string;
  until: string;
}

function toCooldown(row: CooldownRow): ProviderCooldown {
  return {
    providerConnectionId: row.provider_connection_id,
    modelId: row.model_id,
    reason: row.reason,
    detail: row.detail ?? undefined,
    startedAt: row.started_at,
    until: row.until,
  };
}

/**
 * Provider+model pairs parked after a refusal that a retry cannot fix.
 *
 * Kept in SQLite rather than memory so a daemon restart does not immediately
 * re-run into a quota wall the provider already described.
 */
export class ProviderCooldownRepository {
  constructor(private readonly db: SqliteDb) {}

  /** Cooldowns still in force at `now`. Expired rows are dropped as we go. */
  listActive(now: string): ProviderCooldown[] {
    this.db.prepare('DELETE FROM provider_cooldowns WHERE until <= ?').run(now);
    return (
      this.db
        .prepare('SELECT * FROM provider_cooldowns WHERE until > ? ORDER BY until ASC')
        .all(now) as CooldownRow[]
    ).map(toCooldown);
  }

  isCoolingDown(providerConnectionId: string, modelId: string, now: string): boolean {
    const row = this.db
      .prepare(
        'SELECT 1 FROM provider_cooldowns WHERE provider_connection_id = ? AND model_id = ? AND until > ?',
      )
      .get(providerConnectionId, modelId, now);
    return Boolean(row);
  }

  start(input: ProviderCooldown): void {
    this.db
      .prepare(
        `INSERT INTO provider_cooldowns
           (id, provider_connection_id, model_id, reason, detail, started_at, until)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (provider_connection_id, model_id) DO UPDATE SET
           reason = excluded.reason,
           detail = excluded.detail,
           started_at = excluded.started_at,
           -- Never shorten an existing window: two refusals in a row mean the
           -- provider is less available than one of them alone suggested.
           until = MAX(provider_cooldowns.until, excluded.until)`,
      )
      .run(
        randomUUID(),
        input.providerConnectionId,
        input.modelId,
        input.reason,
        input.detail ?? null,
        input.startedAt,
        input.until,
      );
  }

  clear(providerConnectionId: string, modelId: string): void {
    this.db
      .prepare(
        'DELETE FROM provider_cooldowns WHERE provider_connection_id = ? AND model_id = ?',
      )
      .run(providerConnectionId, modelId);
  }
}

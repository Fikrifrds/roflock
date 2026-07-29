import type { SqliteDb } from '../client.js';

export interface TrustedRunner {
  id: string;
  organisationId: string;
  runnerIdentityId: string;
  actorId?: string;
  trustScope: { projectIds: string[]; repositoryIds: string[] };
  status: 'active' | 'rotated' | 'revoked';
  replacedById?: string;
  registeredBy: string;
  registeredAt: string;
  updatedAt: string;
}

export class TrustedRunnerRepository {
  constructor(private readonly db: SqliteDb) {}

  register(value: TrustedRunner): TrustedRunner {
    if (value.status !== 'active') throw new Error('New trusted runner must be active');
    return this.db.transaction(() => {
      this.insert(value);
      this.event(value.id, 'registered', value.registeredBy, {}, value.registeredAt);
      return value;
    })();
  }

  rotate(input: {
    currentId: string;
    replacement: TrustedRunner;
    actorId: string;
    rotatedAt: string;
  }): TrustedRunner {
    return this.db.transaction(() => {
      const current = this.get(input.currentId);
      if (!current || current.status !== 'active') {
        throw new Error('Only an active trusted runner can be rotated');
      }
      if (current.organisationId !== input.replacement.organisationId) {
        throw new Error('Replacement runner must belong to the same organisation');
      }
      this.insert(input.replacement);
      this.db
        .prepare(
          `UPDATE trusted_runners
           SET status = 'rotated', replaced_by_id = ?, updated_at = ? WHERE id = ?`,
        )
        .run(input.replacement.id, input.rotatedAt, current.id);
      this.event(
        current.id,
        'rotated',
        input.actorId,
        { replacementId: input.replacement.id },
        input.rotatedAt,
      );
      this.event(
        input.replacement.id,
        'registered',
        input.actorId,
        { replacesId: current.id },
        input.rotatedAt,
      );
      return input.replacement;
    })();
  }

  revoke(id: string, actorId: string, reason: string, revokedAt: string): TrustedRunner {
    return this.db.transaction(() => {
      const current = this.get(id);
      if (!current || current.status !== 'active') {
        throw new Error('Only an active trusted runner can be revoked');
      }
      this.db
        .prepare(`UPDATE trusted_runners SET status = 'revoked', updated_at = ? WHERE id = ?`)
        .run(revokedAt, id);
      this.db
        .prepare(`UPDATE runner_identities SET status = 'revoked', valid_until = ? WHERE id = ?`)
        .run(revokedAt, current.runnerIdentityId);
      this.event(id, 'revoked', actorId, { reason }, revokedAt);
      return this.get(id)!;
    })();
  }

  canIssue(
    organisationId: string,
    runnerIdentityId: string,
    projectId?: string,
  ): { allowed: boolean; reason: string; trustedRunnerId?: string } {
    const row = this.db
      .prepare(
        `SELECT tr.*, ri.status AS identity_status
         FROM trusted_runners tr
         JOIN runner_identities ri ON ri.id = tr.runner_identity_id
         WHERE tr.organisation_id = ? AND tr.runner_identity_id = ?`,
      )
      .get(organisationId, runnerIdentityId) as Record<string, unknown> | undefined;
    if (!row || row.status !== 'active' || row.identity_status !== 'active') {
      return { allowed: false, reason: 'Runner trust or signing identity is not active.' };
    }
    const runner = mapRunner(row);
    if (projectId && runner.trustScope.projectIds.length > 0) {
      if (!runner.trustScope.projectIds.includes(projectId)) {
        return { allowed: false, reason: 'Runner is outside its trusted project scope.' };
      }
    }
    return {
      allowed: true,
      reason: 'Runner identity and organisation trust are active.',
      trustedRunnerId: runner.id,
    };
  }

  get(id: string): TrustedRunner | undefined {
    const row = this.db.prepare(`SELECT * FROM trusted_runners WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapRunner(row) : undefined;
  }

  private insert(value: TrustedRunner): void {
    this.db
      .prepare(
        `INSERT INTO trusted_runners (
           id, organisation_id, runner_identity_id, actor_id, trust_scope_json, status,
           replaced_by_id, registered_by, registered_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.organisationId,
        value.runnerIdentityId,
        value.actorId ?? null,
        JSON.stringify(value.trustScope),
        value.status,
        value.replacedById ?? null,
        value.registeredBy,
        value.registeredAt,
        value.updatedAt,
      );
  }

  private event(
    trustedRunnerId: string,
    eventType: 'registered' | 'rotated' | 'revoked',
    actorId: string,
    details: Record<string, unknown>,
    createdAt: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO trusted_runner_events (
           id, trusted_runner_id, event_type, actor_id, details_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `${trustedRunnerId}:${eventType}:${createdAt}`,
        trustedRunnerId,
        eventType,
        actorId,
        JSON.stringify(details),
        createdAt,
      );
  }
}

function mapRunner(row: Record<string, unknown>): TrustedRunner {
  return {
    id: String(row.id),
    organisationId: String(row.organisation_id),
    runnerIdentityId: String(row.runner_identity_id),
    actorId: row.actor_id ? String(row.actor_id) : undefined,
    trustScope: JSON.parse(String(row.trust_scope_json)) as TrustedRunner['trustScope'],
    status: row.status as TrustedRunner['status'],
    replacedById: row.replaced_by_id ? String(row.replaced_by_id) : undefined,
    registeredBy: String(row.registered_by),
    registeredAt: String(row.registered_at),
    updatedAt: String(row.updated_at),
  };
}

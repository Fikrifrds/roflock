import type { SqliteDb } from '../client.js';

export interface DisclosureGrant {
  id: string;
  projectId: string;
  providerConnectionId: string;
  scope: Record<string, unknown>;
  createdAt: string;
  revokedAt?: string;
}

export interface CreateDisclosureGrantInput {
  id: string;
  projectId: string;
  providerConnectionId: string;
  scope: Record<string, unknown>;
  createdAt: string;
}

export class DisclosureGrantRepository {
  constructor(private readonly db: SqliteDb) {}

  create(input: CreateDisclosureGrantInput): DisclosureGrant {
    this.db
      .prepare(
        `INSERT INTO disclosure_grants
          (id, project_id, provider_connection_id, scope_json, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        input.id,
        input.projectId,
        input.providerConnectionId,
        JSON.stringify(input.scope),
        input.createdAt,
      );
    return this.get(input.id)!;
  }

  get(id: string): DisclosureGrant | undefined {
    const row = this.db
      .prepare(`SELECT * FROM disclosure_grants WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapGrant(row) : undefined;
  }

  list(filter: { projectId?: string; providerConnectionId?: string } = {}): DisclosureGrant[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.projectId) {
      clauses.push('project_id = ?');
      params.push(filter.projectId);
    }
    if (filter.providerConnectionId) {
      clauses.push('provider_connection_id = ?');
      params.push(filter.providerConnectionId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM disclosure_grants ${where} ORDER BY created_at DESC`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map(mapGrant);
  }

  listActive(projectId: string): DisclosureGrant[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM disclosure_grants
         WHERE project_id = ? AND revoked_at IS NULL
         ORDER BY created_at DESC`,
      )
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map(mapGrant);
  }

  revoke(id: string, revokedAt: string): void {
    this.db
      .prepare(`UPDATE disclosure_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
      .run(revokedAt, id);
  }
}

function mapGrant(row: Record<string, unknown>): DisclosureGrant {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    providerConnectionId: String(row.provider_connection_id),
    scope: JSON.parse(String(row.scope_json)) as Record<string, unknown>,
    createdAt: String(row.created_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : undefined,
  };
}

import type { SqliteDb } from '../client.js';

export interface LeaseRecord {
  id: string;
  resourceType: string;
  resourceId: string;
  ownerId: string;
  acquiredAt: string;
  expiresAt?: string;
  releasedAt?: string;
}

export class LeaseRepository {
  constructor(private readonly db: SqliteDb) {}

  /**
   * Takes the lease, or throws if another owner still holds it.
   *
   * The table has a UNIQUE(resource_type, resource_id) key that outlives a
   * release — `released_at` is set, the row stays. A naive INSERT after a clean
   * release therefore fails with a constraint error even though nobody holds
   * the resource. Reclaiming the released row (or inserting only when none
   * exists) is what makes a second writer turn on the same worktree possible.
   */
  tryAcquire(record: LeaseRecord): LeaseRecord {
    const existing = this.db
      .prepare(
        `SELECT * FROM runtime_leases
         WHERE resource_type = ? AND resource_id = ? AND released_at IS NULL`,
      )
      .get(record.resourceType, record.resourceId) as Record<string, unknown> | undefined;

    if (existing) {
      throw new Error(
        `Lease already held for ${record.resourceType}:${record.resourceId} by ${String(existing.owner_id)}`,
      );
    }

    const prior = this.db
      .prepare(
        `SELECT id FROM runtime_leases WHERE resource_type = ? AND resource_id = ?`,
      )
      .get(record.resourceType, record.resourceId) as { id: string } | undefined;

    if (prior) {
      this.db
        .prepare(
          `UPDATE runtime_leases
           SET id = ?, owner_id = ?, acquired_at = ?, expires_at = ?, released_at = NULL
           WHERE resource_type = ? AND resource_id = ?`,
        )
        .run(
          record.id,
          record.ownerId,
          record.acquiredAt,
          record.expiresAt ?? null,
          record.resourceType,
          record.resourceId,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO runtime_leases
            (id, resource_type, resource_id, owner_id, acquired_at, expires_at, released_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          record.id,
          record.resourceType,
          record.resourceId,
          record.ownerId,
          record.acquiredAt,
          record.expiresAt ?? null,
        );
    }
    return record;
  }

  release(id: string, releasedAt: string): void {
    this.db
      .prepare(`UPDATE runtime_leases SET released_at = ? WHERE id = ?`)
      .run(releasedAt, id);
  }

  getActive(resourceType: string, resourceId: string): LeaseRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM runtime_leases
         WHERE resource_type = ? AND resource_id = ? AND released_at IS NULL`,
      )
      .get(resourceType, resourceId) as Record<string, unknown> | undefined;
    return row ? mapLease(row) : undefined;
  }
}

function mapLease(row: Record<string, unknown>): LeaseRecord {
  return {
    id: String(row.id),
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    ownerId: String(row.owner_id),
    acquiredAt: String(row.acquired_at),
    expiresAt: row.expires_at ? String(row.expires_at) : undefined,
    releasedAt: row.released_at ? String(row.released_at) : undefined,
  };
}

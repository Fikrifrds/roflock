import type { SqliteDb } from '../client.js';

export type OrganisationRole = 'owner' | 'admin' | 'planner' | 'executor' | 'verifier' | 'viewer';
export type OrganisationAction =
  | 'organisation_manage'
  | 'policy_manage'
  | 'contract_authorise'
  | 'plan_manage'
  | 'execute'
  | 'verify'
  | 'passport_read';

export interface Organisation {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

export interface Actor {
  id: string;
  actorType: 'human' | 'service' | 'runner';
  displayName: string;
  primaryEmail?: string;
  status: 'active' | 'suspended' | 'revoked';
  createdAt: string;
  updatedAt: string;
}

export interface OrganisationMembership {
  id: string;
  organisationId: string;
  actorId: string;
  role: OrganisationRole;
  status: 'active' | 'suspended' | 'revoked';
  createdAt: string;
  updatedAt: string;
}

const PERMISSIONS: Record<OrganisationRole, readonly OrganisationAction[]> = {
  owner: [
    'organisation_manage',
    'policy_manage',
    'contract_authorise',
    'plan_manage',
    'execute',
    'verify',
    'passport_read',
  ],
  admin: [
    'organisation_manage',
    'policy_manage',
    'contract_authorise',
    'plan_manage',
    'execute',
    'verify',
    'passport_read',
  ],
  planner: ['plan_manage', 'passport_read'],
  executor: ['execute', 'passport_read'],
  verifier: ['verify', 'passport_read'],
  viewer: ['passport_read'],
};

export class OrganisationRepository {
  constructor(private readonly db: SqliteDb) {}

  createOrganisation(value: Organisation): Organisation {
    this.db
      .prepare(
        `INSERT INTO organisations (id, slug, name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(value.id, value.slug, value.name, value.status, value.createdAt, value.updatedAt);
    return value;
  }

  createActor(value: Actor): Actor {
    this.db
      .prepare(
        `INSERT INTO actors (
           id, actor_type, display_name, primary_email, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.actorType,
        value.displayName,
        value.primaryEmail ?? null,
        value.status,
        value.createdAt,
        value.updatedAt,
      );
    return value;
  }

  upsertMembership(value: OrganisationMembership): OrganisationMembership {
    this.db
      .prepare(
        `INSERT INTO organisation_memberships (
           id, organisation_id, actor_id, role, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(organisation_id, actor_id) DO UPDATE SET
           role = excluded.role, status = excluded.status, updated_at = excluded.updated_at`,
      )
      .run(
        value.id,
        value.organisationId,
        value.actorId,
        value.role,
        value.status,
        value.createdAt,
        value.updatedAt,
      );
    return this.getMembership(value.organisationId, value.actorId)!;
  }

  attachProject(organisationId: string, projectId: string, createdAt: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO organisation_projects (organisation_id, project_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(organisationId, projectId, createdAt);
  }

  authorise(input: {
    organisationId: string;
    actorId: string;
    action: OrganisationAction;
    projectId?: string;
  }): { allowed: boolean; role?: OrganisationRole; reason: string } {
    const organisation = this.db
      .prepare(`SELECT status FROM organisations WHERE id = ?`)
      .get(input.organisationId) as { status: string } | undefined;
    if (!organisation || organisation.status !== 'active') {
      return { allowed: false, reason: 'Organisation is unavailable or suspended.' };
    }
    const actor = this.db.prepare(`SELECT status FROM actors WHERE id = ?`).get(input.actorId) as
      | { status: string }
      | undefined;
    if (!actor || actor.status !== 'active') {
      return { allowed: false, reason: 'Actor is unavailable, suspended, or revoked.' };
    }
    const membership = this.getMembership(input.organisationId, input.actorId);
    if (!membership || membership.status !== 'active') {
      return { allowed: false, reason: 'No active organisation membership exists.' };
    }
    if (input.projectId && !this.isProjectAttached(input.organisationId, input.projectId)) {
      return {
        allowed: false,
        role: membership.role,
        reason: 'Project is outside this organisation scope.',
      };
    }
    const allowed = PERMISSIONS[membership.role].includes(input.action);
    return {
      allowed,
      role: membership.role,
      reason: allowed
        ? `Role ${membership.role} permits ${input.action}.`
        : `Role ${membership.role} does not permit ${input.action}.`,
    };
  }

  getMembership(
    organisationId: string,
    actorId: string,
  ): OrganisationMembership | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM organisation_memberships
         WHERE organisation_id = ? AND actor_id = ?`,
      )
      .get(organisationId, actorId) as Record<string, unknown> | undefined;
    return row ? mapMembership(row) : undefined;
  }

  private isProjectAttached(organisationId: string, projectId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM organisation_projects
           WHERE organisation_id = ? AND project_id = ?`,
        )
        .get(organisationId, projectId),
    );
  }
}

function mapMembership(row: Record<string, unknown>): OrganisationMembership {
  return {
    id: String(row.id),
    organisationId: String(row.organisation_id),
    actorId: String(row.actor_id),
    role: row.role as OrganisationRole,
    status: row.status as OrganisationMembership['status'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

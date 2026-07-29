import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  OrganisationRepository,
  ProjectRepository,
  type OrganisationAction,
  type OrganisationRole,
  type SqliteDb,
} from '@roleflock/database';

const ROLES: OrganisationRole[] = [
  'owner',
  'admin',
  'planner',
  'executor',
  'verifier',
  'viewer',
];
const ACTIONS: OrganisationAction[] = [
  'organisation_manage',
  'policy_manage',
  'contract_authorise',
  'plan_manage',
  'execute',
  'verify',
  'passport_read',
];

export function registerOrganisationRoutes(app: FastifyInstance, db: SqliteDb): void {
  const organisations = new OrganisationRepository(db);
  const projects = new ProjectRepository(db);

  app.post('/api/organisations', async (request) => {
    const body = request.body as Record<string, unknown>;
    const at = new Date().toISOString();
    return organisations.createOrganisation({
      id: `org_${randomUUID()}`,
      slug: required(body.slug, 'slug'),
      name: required(body.name, 'name'),
      status: 'active',
      createdAt: at,
      updatedAt: at,
    });
  });

  app.post('/api/actors', async (request) => {
    const body = request.body as Record<string, unknown>;
    const at = new Date().toISOString();
    return organisations.createActor({
      id: `actor_${randomUUID()}`,
      actorType: enumValue(body.actorType, ['human', 'service', 'runner'], 'actorType'),
      displayName: required(body.displayName, 'displayName'),
      primaryEmail: optional(body.primaryEmail),
      status: 'active',
      createdAt: at,
      updatedAt: at,
    });
  });

  app.put('/api/organisations/:organisationId/members/:actorId', async (request) => {
    const { organisationId, actorId } = request.params as {
      organisationId: string;
      actorId: string;
    };
    const body = request.body as Record<string, unknown>;
    const at = new Date().toISOString();
    return organisations.upsertMembership({
      id: `membership_${randomUUID()}`,
      organisationId,
      actorId,
      role: enumValue(body.role, ROLES, 'role'),
      status: enumValue(
        body.status ?? 'active',
        ['active', 'suspended', 'revoked'],
        'status',
      ),
      createdAt: at,
      updatedAt: at,
    });
  });

  app.put('/api/organisations/:organisationId/projects/:projectId', async (request, reply) => {
    const { organisationId, projectId } = request.params as {
      organisationId: string;
      projectId: string;
    };
    if (!projects.get(projectId)) return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' });
    organisations.attachProject(organisationId, projectId, new Date().toISOString());
    return { organisationId, projectId, attached: true };
  });

  app.post('/api/organisations/:organisationId/authorise', async (request) => {
    const organisationId = (request.params as { organisationId: string }).organisationId;
    const body = request.body as Record<string, unknown>;
    return organisations.authorise({
      organisationId,
      actorId: required(body.actorId, 'actorId'),
      action: enumValue(body.action, ACTIONS, 'action'),
      projectId: optional(body.projectId),
    });
  });
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function optional(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] {
  const resolved = required(value, field);
  if (!allowed.includes(resolved)) throw new Error(`${field} must be one of ${allowed.join(', ')}`);
  return resolved as T[number];
}

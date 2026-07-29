import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  AuditRepository,
  ChangeContractRepository,
  GitHubAuthorityLinkRepository,
  GitHubIntegrationRepository,
  ProjectRepository,
  type SqliteDb,
} from '@roleflock/database';

export function registerGitHubRoutes(app: FastifyInstance, db: SqliteDb): void {
  const github = new GitHubIntegrationRepository(db);
  const projects = new ProjectRepository(db);
  const audit = new AuditRepository(db);
  const links = new GitHubAuthorityLinkRepository(db);
  const contracts = new ChangeContractRepository(db);

  app.post('/api/integrations/github/installations', async (request) => {
    const body = request.body as Record<string, unknown>;
    const timestamp = new Date().toISOString();
    const installation = github.upsertInstallation({
      id: `github_installation_${randomUUID()}`,
      githubInstallationId: required(body.githubInstallationId, 'githubInstallationId'),
      accountId: required(body.accountId, 'accountId'),
      accountLogin: required(body.accountLogin, 'accountLogin'),
      accountType: enumValue(body.accountType, ['User', 'Organization'], 'accountType'),
      status: enumValue(body.status ?? 'active', ['active', 'suspended', 'removed'], 'status'),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    record(audit, 'github.installation_mapped', installation.id, installation, timestamp);
    return installation;
  });

  app.post('/api/integrations/github/repositories', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = optional(body.projectId);
    if (projectId && !projects.get(projectId)) {
      return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' });
    }
    const installation = github.getInstallationByGitHubId(
      required(body.githubInstallationId, 'githubInstallationId'),
    );
    if (!installation) {
      return reply.code(404).send({ code: 'GITHUB_INSTALLATION_NOT_FOUND' });
    }
    const timestamp = new Date().toISOString();
    const repository = github.upsertRepository({
      id: `github_repository_${randomUUID()}`,
      installationId: installation.id,
      githubRepositoryId: required(body.githubRepositoryId, 'githubRepositoryId'),
      nodeId: optional(body.nodeId),
      ownerLogin: required(body.ownerLogin, 'ownerLogin'),
      name: required(body.name, 'name'),
      fullName: required(body.fullName, 'fullName'),
      defaultBranch: required(body.defaultBranch, 'defaultBranch'),
      projectId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    record(audit, 'github.repository_mapped', repository.id, repository, timestamp);
    return repository;
  });

  app.post('/api/integrations/github/actors', async (request) => {
    const body = request.body as Record<string, unknown>;
    const timestamp = new Date().toISOString();
    const actor = github.upsertActor({
      id: `github_actor_${randomUUID()}`,
      githubUserId: required(body.githubUserId, 'githubUserId'),
      nodeId: optional(body.nodeId),
      login: required(body.login, 'login'),
      roleflockActorId: required(body.roleflockActorId, 'roleflockActorId'),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    record(audit, 'github.actor_mapped', actor.id, actor, timestamp);
    return actor;
  });

  app.get('/api/projects/:projectId/github', async (request, reply) => {
    const projectId = (request.params as { projectId: string }).projectId;
    if (!projects.get(projectId)) return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' });
    return github.getRepositoryByProject(projectId) ?? null;
  });

  app.post('/api/tasks/:taskId/github-links', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const body = request.body as Record<string, unknown>;
    const aggregate = contracts.getByTask(taskId);
    const contract = aggregate ? contracts.getCurrent(aggregate.id)?.contract : undefined;
    if (!contract || contract.status !== 'authorised') {
      return reply.code(409).send({ code: 'AUTHORISED_CONTRACT_REQUIRED' });
    }
    const repository = github.getRepositoryByGitHubId(
      required(body.githubRepositoryId, 'githubRepositoryId'),
    );
    if (!repository) return reply.code(404).send({ code: 'GITHUB_REPOSITORY_NOT_FOUND' });
    const subjectNumber = Number(body.subjectNumber);
    if (!Number.isInteger(subjectNumber) || subjectNumber <= 0) {
      throw new Error('subjectNumber must be a positive integer');
    }
    const timestamp = new Date().toISOString();
    const link = links.create({
      id: `github_link_${randomUUID()}`,
      taskId,
      contractId: contract.id,
      contractHash: contract.hash,
      githubRepositoryMappingId: repository.id,
      subjectType: enumValue(
        body.subjectType,
        ['issue', 'pull_request'],
        'subjectType',
      ),
      subjectNumber,
      subjectNodeId: optional(body.subjectNodeId),
      subjectUrl: required(body.subjectUrl, 'subjectUrl'),
      linkType: enumValue(
        body.linkType,
        ['authority_source', 'delivery_target'],
        'linkType',
      ),
      linkedBy: required(body.linkedBy, 'linkedBy'),
      linkedAt: timestamp,
    });
    record(audit, 'github.authority_linked', link.id, link, timestamp);
    return link;
  });

  app.get('/api/tasks/:taskId/github-links', async (request) => {
    const taskId = (request.params as { taskId: string }).taskId;
    return links.listByTask(taskId);
  });
}

function required(value: unknown, field: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw new Error(`${field} is required`);
  }
  return String(value).trim();
}

function optional(value: unknown): string | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  return String(value).trim();
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

function record(
  audit: AuditRepository,
  action: string,
  targetId: string,
  details: unknown,
  createdAt: string,
): void {
  audit.append({
    id: randomUUID(),
    actor: 'local-user',
    action,
    targetType: 'github_integration',
    targetId,
    details: { mapping: details },
    createdAt,
  });
}

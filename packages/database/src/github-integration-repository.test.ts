import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, migrate, type SqliteDb } from './client.js';
import { GitHubIntegrationRepository } from './repositories/github-integration-repository.js';
import { GitHubAuthorityLinkRepository } from './repositories/github-authority-link-repository.js';
import { GitHubStatusCheckRepository } from './repositories/github-status-check-repository.js';
import { GitHubReviewPublicationRepository } from './repositories/github-review-publication-repository.js';
import { GitHubCommentFeedbackRepository } from './repositories/github-comment-feedback-repository.js';
import { FeedbackRepository } from './repositories/feedback-repository.js';

let db: SqliteDb | undefined;
afterEach(() => db?.close());

describe('GitHub identity and repository mapping', () => {
  it('durably maps installation, repository, project, and actor identities', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    seedProject(db);
    const repository = new GitHubIntegrationRepository(db);
    const at = '2026-07-28T12:00:00.000Z';
    repository.upsertInstallation({
      id: 'github_installation_1',
      githubInstallationId: '1001',
      accountId: '2001',
      accountLogin: 'roleflock',
      accountType: 'Organization',
      status: 'active',
      createdAt: at,
      updatedAt: at,
    });
    repository.upsertRepository({
      id: 'github_repository_1',
      installationId: 'github_installation_1',
      githubRepositoryId: '3001',
      nodeId: 'R_repo',
      ownerLogin: 'roleflock',
      name: 'core',
      fullName: 'roleflock/core',
      defaultBranch: 'main',
      projectId: 'project_1',
      createdAt: at,
      updatedAt: at,
    });
    repository.upsertActor({
      id: 'github_actor_1',
      githubUserId: '4001',
      nodeId: 'U_actor',
      login: 'octocat',
      roleflockActorId: 'actor_local_1',
      createdAt: at,
      updatedAt: at,
    });
    expect(repository.getRepositoryByProject('project_1')).toMatchObject({
      githubRepositoryId: '3001',
      fullName: 'roleflock/core',
    });
    expect(repository.getActorByGitHubId('4001')).toMatchObject({
      login: 'octocat',
      roleflockActorId: 'actor_local_1',
    });
    const links = new GitHubAuthorityLinkRepository(db);
    links.create({
      id: 'github_link_1',
      taskId: 'task_1',
      contractId: 'contract_1',
      contractHash: '1'.repeat(64),
      githubRepositoryMappingId: 'github_repository_1',
      subjectType: 'issue',
      subjectNumber: 42,
      subjectUrl: 'https://github.com/roleflock/core/issues/42',
      linkType: 'authority_source',
      linkedBy: 'actor_local_1',
      linkedAt: at,
    });
    expect(links.listByTask('task_1')).toMatchObject([
      {
        contractHash: '1'.repeat(64),
        subjectNumber: 42,
        linkType: 'authority_source',
      },
    ]);
    expect(() =>
      db!.prepare(`UPDATE github_authority_links SET subject_number = 43`).run(),
    ).toThrow(/immutable/);
    const checks = new GitHubStatusCheckRepository(db);
    checks.create({
      id: 'status_1',
      githubRepositoryMappingId: 'github_repository_1',
      taskId: 'task_1',
      commitSha: 'a'.repeat(40),
      passportId: 'passport_1',
      passportPayloadDigest: '2'.repeat(64),
      conclusion: 'success',
      summary: 'PASS',
      createdAt: at,
    });
    expect(checks.evaluateCommit('github_repository_1', 'a'.repeat(40))).toMatchObject({
      state: 'current',
      check: { conclusion: 'success' },
    });
    expect(checks.evaluateCommit('github_repository_1', 'b'.repeat(40))).toMatchObject({
      state: 'missing',
      invalidatedCheck: { id: 'status_1', commitSha: 'a'.repeat(40) },
    });
    const publications = new GitHubReviewPublicationRepository(db);
    publications.create({
      id: 'publication_1',
      githubRepositoryMappingId: 'github_repository_1',
      taskId: 'task_1',
      pullRequestNumber: 7,
      commitSha: 'a'.repeat(40),
      passportId: 'passport_1',
      passportPayloadDigest: '2'.repeat(64),
      packetBodyDigest: '3'.repeat(64),
      githubCommentId: 'comment_1',
      publishedBy: 'actor_local_1',
      publishedAt: at,
    });
    expect(publications.listByTask('task_1')).toMatchObject([
      {
        pullRequestNumber: 7,
        commitSha: 'a'.repeat(40),
        packetBodyDigest: '3'.repeat(64),
      },
    ]);
    new FeedbackRepository(db).create({
      id: 'feedback_1',
      taskId: 'task_1',
      sourceActorId: 'actor_local_1',
      text: 'Please change the color.',
      classification: 'interactive_cosmetic_change',
      status: 'routed',
      routedRole: 'planner',
      idempotencyKey: 'github-comment:comment_1',
      requestHash: '4'.repeat(64),
      createdAt: at,
      updatedAt: at,
    });
    const commentReceipts = new GitHubCommentFeedbackRepository(db);
    commentReceipts.create({
      id: 'comment_feedback_1',
      githubRepositoryMappingId: 'github_repository_1',
      githubCommentId: 'comment_1',
      subjectType: 'issue',
      subjectNumber: 42,
      githubActorMappingId: 'github_actor_1',
      bodyDigest: '5'.repeat(64),
      feedbackId: 'feedback_1',
      receivedAt: at,
    });
    expect(commentReceipts.getByCommentId('comment_1')).toMatchObject({
      feedbackId: 'feedback_1',
      bodyDigest: '5'.repeat(64),
    });
  });
});

function seedProject(database: SqliteDb): void {
  database
    .prepare(
      `INSERT INTO projects (
         id, workspace_id, name, repository_path, resolved_path, base_branch,
         status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'project_1',
      'workspace_1',
      'Core',
      '/repo',
      '/repo',
      'main',
      'active',
      '2026-07-28T12:00:00.000Z',
      '2026-07-28T12:00:00.000Z',
    );
  database
    .prepare(
      `INSERT INTO tasks (
         id, project_id, type, title, brief, risk, state, workflow_graph_version_id,
         budget_policy_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'task_1',
      'project_1',
      'feature',
      'GitHub link',
      'Trace authority',
      'medium',
      'CONTRACT_AUTHORISED',
      'graph_1',
      'budget_1',
      '2026-07-28T12:00:00.000Z',
      '2026-07-28T12:00:00.000Z',
    );
}

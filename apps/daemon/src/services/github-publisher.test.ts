import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_STATUS_CONTEXT,
  GitHubIntegrationRepository,
  GitHubPublicationSettingsRepository,
  openMigratedDatabase,
  type GitHubRepositoryMapping,
  type GitHubStatusCheck,
} from '@roleflock/database';
import { GitHubApiError, GitHubClient } from '@roleflock/github-client';
import { InMemorySecretStore } from '@roleflock/secret-store';
import { describe, expect, it } from 'vitest';
import { GitHubPublisher } from './github-publisher.js';

const MAPPING_ID = 'github_repository_1';
const TOKEN_SECRET_ID = 'github.publication.github_repository_1';

const repository: GitHubRepositoryMapping = {
  id: MAPPING_ID,
  installationId: 'github_installation_1',
  githubRepositoryId: '1',
  ownerLogin: 'acme',
  name: 'core',
  fullName: 'acme/core',
  defaultBranch: 'main',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function check(conclusion: GitHubStatusCheck['conclusion']): GitHubStatusCheck {
  return {
    id: 'github_status_1',
    githubRepositoryMappingId: MAPPING_ID,
    taskId: 'task_1',
    commitSha: 'a'.repeat(40),
    conclusion,
    summary: 'RoleFlock PASS is bound to this exact commit.',
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

function fixture(options: {
  enabled: boolean;
  withToken?: boolean;
  publishReviewComments?: boolean;
  respond?: (path: string, payload: unknown) => Response;
}) {
  const directory = mkdtempSync(join(tmpdir(), 'roleflock-gh-publish-'));
  const db = openMigratedDatabase(join(directory, 'test.db'));
  // Settings reference a real repository mapping, so the rows the publisher
  // reads exist for the same reason they would in production.
  const integration = new GitHubIntegrationRepository(db);
  integration.upsertInstallation({
    id: repository.installationId,
    githubInstallationId: '100',
    accountId: '200',
    accountLogin: 'acme',
    accountType: 'Organization',
    status: 'active',
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt,
  });
  integration.upsertRepository(repository);
  const settings = new GitHubPublicationSettingsRepository(db);
  settings.upsert({
    githubRepositoryMappingId: MAPPING_ID,
    enabled: options.enabled,
    ...(options.withToken === false ? {} : { tokenSecretId: TOKEN_SECRET_ID }),
    statusContext: DEFAULT_STATUS_CONTEXT,
    publishReviewComments: options.publishReviewComments ?? false,
    updatedAt: '2026-08-01T00:00:00.000Z',
  });

  const secrets = new InMemorySecretStore();
  if (options.withToken !== false) void secrets.set(TOKEN_SECRET_ID, 'ghp_publisher');

  const requests: Array<{ path: string; payload: unknown }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const payload = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    requests.push({ path, payload });
    return (
      options.respond?.(path, payload) ??
      new Response(JSON.stringify({ id: 1, url: 'https://api/s/1', html_url: 'https://gh/c/1' }), {
        status: 201,
      })
    );
  }) as unknown as typeof fetch;

  const publisher = new GitHubPublisher({
    settings,
    secrets,
    createClient: (token) => new GitHubClient({ token, fetchImpl }),
  });
  return { publisher, requests, settings };
}

describe('GitHubPublisher', () => {
  it('makes no outbound call at all when the repository has not opted in', async () => {
    const { publisher, requests } = fixture({ enabled: false });
    const outcome = await publisher.publishStatusCheck({ repository, check: check('success') });

    expect(outcome).toEqual({
      published: false,
      reason: 'disabled',
      detail: 'GitHub publication is not enabled for this repository.',
    });
    expect(requests).toEqual([]);
  });

  it('publishes a commit status against the exact commit the check names', async () => {
    const { publisher, requests } = fixture({ enabled: true });
    const outcome = await publisher.publishStatusCheck({ repository, check: check('success') });

    expect(outcome).toEqual({ published: true, target: 'https://api/s/1' });
    expect(requests[0]!.path).toBe(`/repos/acme/core/statuses/${'a'.repeat(40)}`);
    expect(requests[0]!.payload).toMatchObject({
      state: 'success',
      context: DEFAULT_STATUS_CONTEXT,
    });
  });

  it('reports a failed assurance decision as a failed check, not a broken one', async () => {
    const { publisher, requests } = fixture({ enabled: true });
    await publisher.publishStatusCheck({ repository, check: check('failure') });
    // `error` would read as the check itself having broken; a failing verdict is
    // the check working.
    expect((requests[0]!.payload as { state: string }).state).toBe('failure');

    const pending = fixture({ enabled: true });
    await pending.publisher.publishStatusCheck({ repository, check: check('pending') });
    expect((pending.requests[0]!.payload as { state: string }).state).toBe('pending');
  });

  it('refuses to publish when enabled without a usable token', async () => {
    const { publisher, requests } = fixture({ enabled: true, withToken: false });
    const outcome = await publisher.publishStatusCheck({ repository, check: check('success') });

    expect(outcome).toMatchObject({ published: false, reason: 'no_credential' });
    expect(requests).toEqual([]);
  });

  it('keeps review comments behind their own switch', async () => {
    const off = fixture({ enabled: true, publishReviewComments: false });
    expect(
      await off.publisher.publishReviewComment({ repository, pullRequestNumber: 7, body: '# p' }),
    ).toMatchObject({ published: false, reason: 'disabled' });
    expect(off.requests).toEqual([]);

    const on = fixture({ enabled: true, publishReviewComments: true });
    expect(
      await on.publisher.publishReviewComment({ repository, pullRequestNumber: 7, body: '# p' }),
    ).toEqual({ published: true, target: 'https://gh/c/1' });
    expect(on.requests[0]!.path).toBe('/repos/acme/core/issues/7/comments');
  });

  it('reports a transport failure without turning it into a different verdict', async () => {
    const { publisher } = fixture({
      enabled: true,
      respond: () =>
        new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }),
    });
    const outcome = await publisher.publishStatusCheck({ repository, check: check('success') });

    expect(outcome).toMatchObject({
      published: false,
      reason: 'failed',
      code: 'unauthorized',
    });
    // The check's own conclusion is untouched by how the delivery went.
    expect(check('success').conclusion).toBe('success');
  });

  it('surfaces a rate limit as retryable rather than as a permission problem', async () => {
    const { publisher } = fixture({
      enabled: true,
      respond: () =>
        new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'retry-after': '30' },
        }),
    });
    const outcome = await publisher.publishStatusCheck({ repository, check: check('success') });
    expect(outcome).toMatchObject({ reason: 'failed', code: 'rate_limited' });
    expect(GitHubApiError.name).toBe('GitHubApiError');
  });
});

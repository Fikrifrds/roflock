import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.pop();
    if (fn) await fn();
  }
});

async function boot() {
  const dataDir = await mkdtemp(join(tmpdir(), 'rf-gh-pub-data-'));
  const repoDir = await mkdtemp(join(tmpdir(), 'rf-gh-pub-repo-'));
  execFileSync('git', ['init'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'RoleFlock'], { cwd: repoDir });
  await writeFile(join(repoDir, 'README.md'), '# fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });

  const session = { token: 'test-token', csrf: 'test-csrf' };
  const instance = await createServer({ dataDir, session });
  cleanup.push(async () => {
    await instance.app.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  });

  const headers = {
    'x-roleflock-token': session.token,
    'x-roleflock-csrf': session.csrf,
    'content-type': 'application/json',
  };

  const project = await instance.app.inject({
    method: 'POST',
    url: '/api/projects',
    headers,
    payload: { path: repoDir },
  });
  const projectId = (project.json() as { id: string }).id;

  await instance.app.inject({
    method: 'POST',
    url: '/api/integrations/github/installations',
    headers,
    payload: {
      githubInstallationId: '100',
      accountId: '200',
      accountLogin: 'acme',
      accountType: 'Organization',
    },
  });
  await instance.app.inject({
    method: 'POST',
    url: '/api/integrations/github/repositories',
    headers,
    payload: {
      githubInstallationId: '100',
      githubRepositoryId: '300',
      ownerLogin: 'acme',
      name: 'core',
      fullName: 'acme/core',
      defaultBranch: 'main',
      projectId,
    },
  });

  return { app: instance.app, headers, projectId };
}

describe('GitHub publication settings API', () => {
  it('is off until a repository is explicitly opted in', async () => {
    const { app, headers, projectId } = await boot();
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/github-publication`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      enabled: false,
      publishReviewComments: false,
      tokenStored: false,
    });
  });

  it('refuses to enable publication without a token to publish with', async () => {
    const { app, headers, projectId } = await boot();
    const response = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/github-publication`,
      headers,
      payload: { enabled: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'GITHUB_TOKEN_REQUIRED' });
  });

  it('stores the token without ever returning it', async () => {
    const { app, headers, projectId } = await boot();
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/github-publication`,
      headers,
      payload: { enabled: true, token: 'ghp_secret_value', publishReviewComments: true },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain('ghp_secret_value');
    expect(saved.json()).toMatchObject({
      enabled: true,
      publishReviewComments: true,
      tokenStored: true,
      statusContext: 'roleflock/assurance',
    });

    const read = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/github-publication`,
      headers,
    });
    expect(read.body).not.toContain('ghp_secret_value');
    expect(read.json()).toMatchObject({ enabled: true, tokenStored: true });
  });

  it('drops the stored credential when publication is switched off', async () => {
    const { app, headers, projectId } = await boot();
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/github-publication`,
      headers,
      payload: { enabled: true, token: 'ghp_secret_value' },
    });
    const disabled = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/github-publication`,
      headers,
      payload: { enabled: false },
    });
    // Leaving a usable token behind is not what "off" should mean.
    expect(disabled.json()).toMatchObject({ enabled: false, tokenStored: false });
  });

  it('records a status check and reports that it was not sent while disabled', async () => {
    const { app, headers, projectId } = await boot();
    const task = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers,
      payload: {
        projectId,
        type: 'chore',
        mode: 'direct',
        title: 'Status check without publication',
        brief: 'The decision is durable whether or not it reaches GitHub.',
      },
    });
    const taskId = (task.json() as { id: string }).id;

    const response = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/github-status-check`,
      headers,
      payload: { commitSha: 'a'.repeat(40) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      conclusion: string;
      publication: { published: boolean; reason?: string };
    };
    // No passport exists, so the decision is a failure — and it is recorded
    // regardless of whether anything was published.
    expect(body.conclusion).toBe('failure');
    expect(body.publication).toMatchObject({ published: false, reason: 'disabled' });
  });
});

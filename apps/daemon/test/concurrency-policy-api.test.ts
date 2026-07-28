import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) await cleanup();
  }
});

describe('concurrency policy API', () => {
  it('version-checks durable global and project limits', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'roleflock-concurrency-api-'));
    const repositoryDir = await mkdtemp(join(tmpdir(), 'roleflock-concurrency-repo-'));
    execFileSync('git', ['init'], { cwd: repositoryDir });
    execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], {
      cwd: repositoryDir,
    });
    execFileSync('git', ['config', 'user.name', 'RoleFlock Test'], {
      cwd: repositoryDir,
    });
    await writeFile(join(repositoryDir, 'README.md'), '# Concurrency fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repositoryDir });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repositoryDir });
    const session = { token: 'test-token', csrf: 'test-csrf' };
    const server = await createServer({ dataDir, session });
    cleanups.push(async () => {
      await server.app.close();
      await rm(dataDir, { recursive: true, force: true });
      await rm(repositoryDir, { recursive: true, force: true });
    });
    const headers = {
      'x-roleflock-token': session.token,
      'x-roleflock-csrf': session.csrf,
      'content-type': 'application/json',
    };
    const projectResponse = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: { path: repositoryDir },
    });
    const project = projectResponse.json() as { id: string };

    const initial = await server.app.inject({
      method: 'GET',
      url: `/api/concurrency-policy?projectId=${project.id}`,
      headers,
    });
    expect(initial.json()).toMatchObject({
      global: { maxActiveTasks: 4, revision: 1 },
      project: { maxActiveTasks: 2, revision: 1 },
      activeTaskIds: [],
    });

    const global = await server.app.inject({
      method: 'PUT',
      url: '/api/concurrency-policy/global',
      headers: { ...headers, 'if-match': '"1"' },
      payload: { maxActiveTasks: 6 },
    });
    expect(global.statusCode).toBe(200);
    expect(global.headers.etag).toBe('"2"');
    expect(global.json()).toMatchObject({ maxActiveTasks: 6, revision: 2 });

    const stale = await server.app.inject({
      method: 'PUT',
      url: '/api/concurrency-policy/global',
      headers: { ...headers, 'if-match': '"1"' },
      payload: { maxActiveTasks: 7 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'CONCURRENCY_POLICY_UPDATE_FAILED' });

    const projectPolicy = await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/concurrency-policy`,
      headers: { ...headers, 'if-match': '"1"' },
      payload: { maxActiveTasks: 3 },
    });
    expect(projectPolicy.statusCode).toBe(200);
    expect(projectPolicy.json()).toMatchObject({ maxActiveTasks: 3, revision: 2 });
  });
});

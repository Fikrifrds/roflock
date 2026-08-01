import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { authoriseTaskContract } from './contract-fixture.js';

const cleanup: Array<() => Promise<void>> = [];
const session = { token: 'test-token', csrf: 'test-csrf' };
const headers = {
  'x-roleflock-token': session.token,
  'x-roleflock-csrf': session.csrf,
  'content-type': 'application/json',
};

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

async function waitFor(
  app: Awaited<ReturnType<typeof createServer>>['app'],
  path: string,
  predicate: (body: unknown) => boolean,
  timeoutMs = 10_000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await app.inject({ method: 'GET', url: path, headers });
    const body = response.json();
    if (predicate(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

describe('daemon recovery', () => {
  it('retains pending confirmations and tasks across restart', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rf-recovery-data-'));
    const repoDir = await mkdtemp(join(tmpdir(), 'rf-recovery-repo-'));
    cleanup.push(async () => {
      await rm(dataDir, { recursive: true, force: true });
      await rm(repoDir, { recursive: true, force: true });
    });
    execFileSync('git', ['init'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'RoleFlock'], { cwd: repoDir });
    await writeFile(join(repoDir, 'README.md'), '# recovery fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });

    const first = await createServer({ dataDir, session });
    let firstClosed = false;
    cleanup.push(async () => {
      if (!firstClosed) await first.app.close();
    });

    const project = await first.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: { path: repoDir },
    });
    expect(project.statusCode).toBe(201);
    const projectId = (project.json() as { id: string }).id;

    const task = await first.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers,
      payload: {
        projectId,
        type: 'bug_fix',
        // Recovery is about the confirmation surviving a restart, not about
        // assurance; `bug_fix` now recommends `assured`, which needs an
        // approved plan this test deliberately does not create.
        mode: 'bug_fix',
        title: 'Persist confirmation',
        brief: 'Confirm that a pending approval survives a daemon restart.',
      },
    });
    expect(task.statusCode).toBe(201);
    const taskId = (task.json() as { id: string }).id;
    await authoriseTaskContract(first.app, headers, taskId);

    expect(
      (
        await first.app.inject({
          method: 'POST',
          url: `/api/tasks/${taskId}/start`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(202);

    const pending = (await waitFor(
      first.app,
      '/api/approvals',
      (body) => Array.isArray(body) && body.length > 0,
    )) as Array<{ id: string; taskId: string }>;
    expect(
      await waitFor(
        first.app,
        `/api/tasks/${taskId}`,
        (body) => (body as { state: string }).state === 'awaiting_confirmation',
      ),
    ).toMatchObject({ id: taskId });

    await first.app.close();
    firstClosed = true;

    const restarted = await createServer({ dataDir, session });
    cleanup.push(async () => restarted.app.close());
    expect(
      (await restarted.app.inject({ method: 'GET', url: '/api/runtime/info', headers })).statusCode,
    ).toBe(200);

    // The scheduler state survives: the interrupted run keeps the nodes that
    // finished, so a restart resumes instead of redoing paid work.
    const runView = (
      await restarted.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/graph`, headers })
    ).json() as {
      runState: string;
      graph: { version: string; nodes: Array<{ id: string; state: string }> };
    };
    expect(runView.runState).toBe('interrupted');
    expect(runView.graph.version).toMatch(/^bug_fix@\d+$/);
    expect(runView.graph.nodes.find((n) => n.id === 'planner')?.state).toBe('completed');
    expect(runView.graph.nodes.find((n) => n.id === 'planner_tests')?.state).toBe('completed');
    expect(runView.graph.nodes.find((n) => n.id === 'writer')?.state).toBe('pending');

    const recoveredApprovals = (await restarted.app.inject({
      method: 'GET',
      url: '/api/approvals',
      headers,
    })) as { json: () => Array<{ id: string; taskId: string }> };
    expect(recoveredApprovals.json()).toContainEqual(
      expect.objectContaining({ id: pending[0]?.id, taskId }),
    );
    expect(
      (
        await restarted.app.inject({
          method: 'GET',
          url: `/api/tasks/${taskId}`,
          headers,
        })
      ).json(),
    ).toMatchObject({ id: taskId, state: 'awaiting_confirmation' });

    expect(
      (
        await restarted.app.inject({
          method: 'POST',
          url: `/api/approvals/${pending[0]?.id}/approve`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    await waitFor(
      restarted.app,
      `/api/tasks/${taskId}`,
      (body) => (body as { state: string }).state === 'running',
    );
  }, 30_000);
});

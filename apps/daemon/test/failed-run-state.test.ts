import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

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

async function boot() {
  const dataDir = await mkdtemp(join(tmpdir(), 'rf-failed-data-'));
  const repoDir = await mkdtemp(join(tmpdir(), 'rf-failed-repo-'));
  execFileSync('git', ['init'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'RoleFlock'], { cwd: repoDir });
  await writeFile(join(repoDir, 'README.md'), '# fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });

  const instance = await createServer({ dataDir, session });
  cleanup.push(async () => {
    await instance.app.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  });
  return { app: instance.app, repoDir };
}

async function waitFor(
  app: Awaited<ReturnType<typeof boot>>['app'],
  path: string,
  predicate: (body: unknown) => boolean,
  timeoutMs = 10_000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const body = (await app.inject({ method: 'GET', url: path, headers })).json();
    if (predicate(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

describe('a failed run leaves no node still claiming to work', () => {
  it('records the failing node and marks what never ran as skipped', async () => {
    const { app, repoDir } = await boot();

    const projectId = (
      (
        await app.inject({
          method: 'POST',
          url: '/api/projects',
          headers,
          payload: { path: repoDir },
        })
      ).json() as { id: string }
    ).id;

    const taskId = (
      (
        await app.inject({
          method: 'POST',
          url: '/api/tasks',
          headers,
          payload: {
            projectId,
            type: 'bug_fix',
            title: 'Reject the reviewer',
            brief: 'A rejected confirmation must fail the run cleanly.',
          },
        })
      ).json() as { id: string }
    ).id;

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/tasks/${taskId}/start`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(202);

    const approvals = (await waitFor(
      app,
      '/api/approvals',
      (body) => Array.isArray(body) && body.length > 0,
    )) as Array<{ id: string }>;

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/approvals/${approvals[0]!.id}/reject`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);

    await waitFor(
      app,
      `/api/tasks/${taskId}`,
      (body) => (body as { state: string }).state === 'failed',
    );

    const runView = (
      await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/graph`, headers })
    ).json() as {
      runState: string;
      graph: {
        nodes: Array<{
          id: string;
          state: string;
          completedAt: string | null;
          outcome: string | null;
        }>;
      };
    };
    const node = (id: string) => runView.graph.nodes.find((entry) => entry.id === id)!;

    expect(runView.runState).toBe('failed');
    expect(node('planner').state).toBe('completed');
    expect(node('planner_tests').state).toBe('completed');
    // The failing node used to stay `running` for good, because only the
    // success path ever wrote a terminal state.
    expect(node('reviewer').state).toBe('failed');
    expect(node('reviewer').completedAt).not.toBeNull();
    expect(node('reviewer').outcome).toContain('Confirmation rejected');
    // And a stopped run will never schedule what it never started, so calling
    // those nodes `pending` claimed work was still queued.
    for (const id of ['writer', 'test', 'verifier', 'accept']) {
      expect(node(id).state).toBe('skipped');
    }

    const evidence = (
      await app.inject({ method: 'GET', url: `/api/evidence/tasks/${taskId}`, headers })
    ).json() as { findings: Array<{ summary: string; nodeRunId: string | null }> };
    const failure = evidence.findings.find((finding) => finding.summary === 'Node reviewer failed');
    expect(failure).toBeDefined();
    // Without the node run the finding cannot be traced back to the turn that
    // produced it, which is the whole point of the ledger.
    expect(failure?.nodeRunId).not.toBeNull();
  }, 30_000);
});

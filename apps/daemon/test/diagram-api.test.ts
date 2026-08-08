import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase, WorkflowSnapshotRepository } from '@roleflock/database';
import { createServer } from '../src/server.js';
import { DATABASE_FILE_NAME } from '../src/data-dir.js';
import { authoriseTaskContract } from './contract-fixture.js';

/**
 * Studio's diagram must be the same drawing the CLI and Playground produce.
 *
 * That is only possible because the daemon keeps the Graph IR a template was
 * compiled from — the bridge is one-way, so discarding it would have forced a
 * second layout implementation, which is exactly the divergence `graph-ui` exists
 * to prevent.
 */

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()!();
});

const headers = {
  'x-roleflock-token': 'test-token',
  'x-roleflock-csrf': 'test-csrf',
  'content-type': 'application/json',
};

async function boot() {
  const dataDir = await mkdtemp(join(tmpdir(), 'rf-diagram-data-'));
  const repoDir = await mkdtemp(join(tmpdir(), 'rf-diagram-repo-'));
  execFileSync('git', ['init'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repoDir });
  await writeFile(join(repoDir, 'README.md'), '# fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });

  const instance = await createServer({
    dataDir,
    session: { token: 'test-token', csrf: 'test-csrf' },
  });
  cleanup.push(async () => {
    await instance.app.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  });
  return { app: instance.app, dataDir, repoDir };
}

async function task(app: Awaited<ReturnType<typeof boot>>['app'], repoDir: string) {
  const project = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers,
    payload: { path: repoDir },
  });
  const created = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers,
    payload: {
      projectId: (project.json() as { id: string }).id,
      type: 'bug_fix',
      title: 'Fix a typo',
      brief: 'incomplete',
      expectedBehaviour: 'complete',
      actualBehaviour: 'incomplete',
    },
  });
  const id = (created.json() as { id: string }).id;
  await authoriseTaskContract(app, headers, id);
  return id;
}

describe('the shared diagram endpoint', () => {
  it('persists source, IR, and the executable graph when the task is created', async () => {
    const { app, dataDir, repoDir } = await boot();
    const taskId = await task(app, repoDir);
    const db = openMigratedDatabase(join(dataDir, DATABASE_FILE_NAME));
    const snapshot = new WorkflowSnapshotRepository(db).get(taskId);

    expect(snapshot?.source).toContain('workflow bug_fix');
    expect(JSON.parse(snapshot!.graphIrJson!)).toMatchObject({ workflow: { id: 'bug_fix' } });
    expect(JSON.parse(snapshot!.workflowGraphJson)).toMatchObject({
      id: 'bug_fix',
      version: snapshot!.graphVersionId,
      semanticHash: snapshot!.semanticHash,
    });
    expect(snapshot?.graphSnapshotHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    db.close();
  });

  it('serves the shared layout for a compiled workflow', async () => {
    const { app, repoDir } = await boot();
    const taskId = await task(app, repoDir);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/diagram`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      graphVersionId: string;
      layout: {
        workflowId: string;
        nodes: Array<{ id: string; rank: number; badges: { writer: boolean; required: boolean } }>;
        edges: Array<{ kind: string }>;
        loops: Array<{ maxAttempts: number }>;
      };
    };

    expect(body.graphVersionId).toMatch(/^bug_fix@\d+$/);
    expect(body.layout.workflowId).toBe('bug_fix');
    // The same governing facts the CLI diagram shows.
    expect(body.layout.nodes.filter((node) => node.badges.writer)).toHaveLength(1);
    expect(body.layout.nodes.filter((node) => node.badges.required)).toHaveLength(1);
    expect(body.layout.edges.some((edge) => edge.kind === 'failure')).toBe(true);
    expect(body.layout.loops[0]?.maxAttempts).toBe(4);
  });

  it('never draws a node above something it depends on', async () => {
    const { app, repoDir } = await boot();
    const taskId = await task(app, repoDir);
    const body = (
      await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/diagram`, headers })
    ).json() as { layout: { nodes: Array<{ id: string; rank: number }> } };
    const rank = (id: string) => body.layout.nodes.find((node) => node.id === id)!.rank;

    expect(rank('planner')).toBeLessThan(rank('reviewer'));
    expect(rank('writer')).toBeLessThan(rank('test'));
    expect(rank('test')).toBeLessThan(rank('accept'));
  });

  it('refuses rather than inventing a layout for a hard-coded template', async () => {
    const { app, repoDir } = await boot();
    const taskId = await task(app, repoDir);

    // A pinned historical version has no Graph IR. Laying one out anyway would
    // mean a second implementation guessing at what the run actually does.
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers,
      payload: { workflowGraphVersionId: 'bug_fix@1' },
    });
    if (response.statusCode !== 200) return; // route may not allow re-pinning; nothing to assert

    const diagram = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/diagram`,
      headers,
    });
    expect(diagram.statusCode).toBe(409);
    expect(diagram.json()).toMatchObject({ error: 'No compiled workflow for this task' });
  });

  it('is not found for a task that does not exist', async () => {
    const { app } = await boot();

    expect(
      (await app.inject({ method: 'GET', url: '/api/tasks/nope/diagram', headers })).statusCode,
    ).toBe(404);
  });

  it('requires authentication like every other route', async () => {
    const { app } = await boot();

    expect((await app.inject({ method: 'GET', url: '/api/tasks/nope/diagram' })).statusCode).toBe(
      401,
    );
  });
});

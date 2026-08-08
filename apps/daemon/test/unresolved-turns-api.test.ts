import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@roleflock/database';
import { DATABASE_FILE_NAME } from '../src/data-dir.js';
import { createServer } from '../src/server.js';
import { authoriseTaskContract } from './contract-fixture.js';

/**
 * A paid turn nobody observed has to reach the operator (ADR-010).
 *
 * The runtime halts rather than guess whether to repeat it. That halt is only
 * useful if the interface can say which step is waiting, so the projection has
 * to carry the fact — decided by the same predicate the orchestrator halts on,
 * against the same rows, not by matching the halt message.
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
  const dataDir = await mkdtemp(join(tmpdir(), 'rf-unresolved-data-'));
  const repoDir = await mkdtemp(join(tmpdir(), 'rf-unresolved-repo-'));
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
  return { app: instance.app, repoDir, dataDir };
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

/** Plants the exact wreckage a crash mid-turn leaves behind. */
function plantInterruptedTurn(
  dataDir: string,
  taskId: string,
  options: { providerConnectionId: string; status: string; outcome: string | null },
) {
  const db = openDatabase({ path: join(dataDir, DATABASE_FILE_NAME) });
  const at = new Date().toISOString();
  db.prepare(
    'INSERT INTO graph_runs (id, task_id, graph_version_id, state, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('gr_1', taskId, 'bug_fix@3', 'interrupted', at, at);
  db.prepare(
    'INSERT INTO node_runs (id, graph_run_id, node_key, state, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('nr_1', 'gr_1', 'writer', 'failed', at, at);
  db.prepare(
    `INSERT INTO invocations
       (id, node_run_id, provider_connection_id, configured_model_id, status, started_at, completed_at, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'inv_1',
    'nr_1',
    options.providerConnectionId,
    'model-1',
    options.status,
    at,
    null,
    options.outcome,
  );
  db.close();
}

async function nodes(app: Awaited<ReturnType<typeof boot>>['app'], id: string) {
  const response = await app.inject({ method: 'GET', url: `/api/tasks/${id}/graph`, headers });
  return (
    response.json() as { graph: { nodes: Array<{ id: string; unresolvedInvocation: boolean }> } }
  ).graph.nodes;
}

describe('the run view and unresolved paid turns', () => {
  it('flags a node whose invocation was left in flight', async () => {
    const { app, repoDir, dataDir } = await boot();
    const id = await task(app, repoDir);

    plantInterruptedTurn(dataDir, id, {
      providerConnectionId: 'claude-1',
      status: 'running',
      outcome: null,
    });

    const implement = (await nodes(app, id)).find((node) => node.id === 'writer');
    expect(implement?.unresolvedInvocation).toBe(true);
  });

  it('does not flag a turn that finished with a known outcome', async () => {
    const { app, repoDir, dataDir } = await boot();
    const id = await task(app, repoDir);

    plantInterruptedTurn(dataDir, id, {
      providerConnectionId: 'claude-1',
      status: 'completed',
      outcome: 'completed',
    });

    const implement = (await nodes(app, id)).find((node) => node.id === 'writer');
    expect(implement?.unresolvedInvocation).toBe(false);
  });

  it('does not flag deterministic work, which costs nothing to repeat', async () => {
    const { app, repoDir, dataDir } = await boot();
    const id = await task(app, repoDir);

    plantInterruptedTurn(dataDir, id, {
      providerConnectionId: 'deterministic',
      status: 'running',
      outcome: null,
    });

    // The whole warning is about money and discarded work. A local command that
    // can simply be re-run must not raise it, or the alert becomes routine.
    const implement = (await nodes(app, id)).find((node) => node.id === 'writer');
    expect(implement?.unresolvedInvocation).toBe(false);
  });
});

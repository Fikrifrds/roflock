import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGraphRun, openMigratedDatabase } from '@roleflock/database';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { authoriseTaskContract } from './contract-fixture.js';

/**
 * R5 exit criterion: a forced daemon restart preserves confirmed progress and
 * does not blindly duplicate provider work.
 *
 * The run is interrupted while parked at the plan-approval gate, which is a
 * deterministic point: the planners have finished and been paid for, and
 * nothing is mid-invocation. What must survive is exactly that — their work
 * stands, and resuming does not buy it a second time.
 *
 * Recovery goes through the approval, not through `/start`. A task waiting at a
 * human gate is waiting on a person, not on the daemon, so it legitimately
 * stays `awaiting_confirmation` across the restart and resolving the surviving
 * approval is what continues it.
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
const session = { token: 'test-token', csrf: 'test-csrf' };

async function repository(): Promise<string> {
  const repoDir = await mkdtemp(join(tmpdir(), 'rf-restart-repo-'));
  execFileSync('git', ['init'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'test@roflock.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Roflock'], { cwd: repoDir });
  await writeFile(join(repoDir, 'README.md'), '# fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });
  cleanup.push(() => rm(repoDir, { recursive: true, force: true }));
  return repoDir;
}

async function bootDaemon(dataDir: string) {
  const instance = await createServer({ dataDir, session });
  return instance.app;
}

async function waitFor(
  app: Awaited<ReturnType<typeof bootDaemon>>,
  path: string,
  predicate: (body: unknown) => boolean,
  attempts = 200,
): Promise<unknown> {
  for (let i = 0; i < attempts; i += 1) {
    const response = await app.inject({ method: 'GET', url: path, headers });
    if (response.statusCode === 200) {
      const body = response.json() as unknown;
      if (predicate(body)) return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

/** Polls a condition against durable state rather than an API projection. */
async function until(predicate: () => boolean, what: string, attempts = 400): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Node runs recorded so far, oldest first, as (node, state) pairs. */
function nodeRuns(dataDir: string): Array<{ node: string; state: string }> {
  const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
  const rows = db
    .prepare('SELECT node_key, state FROM node_runs ORDER BY created_at ASC')
    .all() as Array<{ node_key: string; state: string }>;
  db.close();
  return rows.map((row) => ({ node: row.node_key, state: row.state }));
}

/**
 * Billable turns recorded per node.
 *
 * This, not `node_runs`, is what "paying twice" means. A resumed run writes a
 * marker node run for work it inherited — that row is a record of resumption,
 * not of a new provider turn.
 */
function invocationsPerNode(dataDir: string): Record<string, number> {
  const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
  const rows = db
    .prepare(
      `SELECT n.node_key AS node, COUNT(*) AS count
         FROM invocations i JOIN node_runs n ON n.id = i.node_run_id
        WHERE i.provider_connection_id != 'deterministic'
        GROUP BY n.node_key`,
    )
    .all() as Array<{ node: string; count: number }>;
  db.close();
  return Object.fromEntries(rows.map((row) => [row.node, row.count]));
}

function graphRuns(dataDir: string): Array<{ id: string; state: string }> {
  const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
  const rows = db
    .prepare('SELECT id, state FROM graph_runs ORDER BY created_at ASC')
    .all() as Array<{ id: string; state: string }>;
  db.close();
  return rows;
}

describe('a forced daemon restart', () => {
  it('preserves confirmed work and does not pay for it twice', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rf-restart-data-'));
    cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
    const repoDir = await repository();

    // --- First daemon: run until the plan-approval gate --------------------
    const first = await bootDaemon(dataDir);
    const project = await first.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: { path: repoDir },
    });
    expect(project.statusCode).toBe(201);

    const task = await first.inject({
      method: 'POST',
      url: '/api/tasks',
      headers,
      payload: {
        projectId: (project.json() as { id: string }).id,
        type: 'bug_fix',
        title: 'Fix README typo',
        brief: 'README is incomplete',
        expectedBehaviour: 'Has fix note',
        actualBehaviour: 'Missing fix note',
      },
    });
    expect(task.statusCode).toBe(201);
    const taskId = (task.json() as { id: string }).id;
    await authoriseTaskContract(first, headers, taskId);

    expect(
      (
        await first.inject({
          method: 'POST',
          url: `/api/tasks/${taskId}/start`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(202);

    const pending = (await waitFor(
      first,
      '/api/approvals',
      (body) => Array.isArray(body) && body.length > 0,
    )) as Array<{ id: string }>;

    const beforeCrash = nodeRuns(dataDir);
    const plannersBefore = beforeCrash.filter((run) => run.node.startsWith('planner'));
    expect(plannersBefore.length).toBeGreaterThan(0);
    expect(plannersBefore.every((run) => run.state === 'completed')).toBe(true);
    const billedBefore = invocationsPerNode(dataDir);
    expect(billedBefore['planner']).toBeGreaterThan(0);

    // --- The crash ----------------------------------------------------------
    await first.close();

    // --- Second daemon on the same data -------------------------------------
    const second = await bootDaemon(dataDir);
    cleanup.push(async () => {
      await second.close();
    });

    const runsAfterBoot = graphRuns(dataDir);
    // Interrupted, not failed: the completed nodes are still good, which is what
    // makes resuming them legitimate rather than a guess.
    expect(runsAfterBoot.every((run) => run.state !== 'running')).toBe(true);
    expect(runsAfterBoot.some((run) => run.state === 'interrupted')).toBe(true);

    // Boot reconciliation must not rewrite what already finished.
    expect(
      nodeRuns(dataDir).filter((run) => run.node.startsWith('planner') && run.state === 'completed')
        .length,
    ).toBe(plannersBefore.length);

    // --- The surviving approval ---------------------------------------------
    expect(
      (await second.inject({ method: 'GET', url: `/api/tasks/${taskId}`, headers })).json(),
    ).toMatchObject({ state: 'awaiting_confirmation' });

    const recovered = (
      await second.inject({ method: 'GET', url: '/api/approvals', headers })
    ).json() as Array<{ id: string }>;
    expect(recovered.map((approval) => approval.id)).toContain(pending[0]!.id);

    expect(
      (
        await second.inject({
          method: 'POST',
          url: `/api/approvals/${pending[0]!.id}/approve`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);

    // Paused, not running. The orchestrator that asked for this decision did not
    // survive, so claiming the task is running would describe a process that
    // does not exist — and `running` is a state `/start` refuses, which used to
    // strand the task with no way back.
    await waitFor(
      second,
      `/api/tasks/${taskId}`,
      (body) => (body as { state: string }).state === 'paused',
    );

    // --- Resume -------------------------------------------------------------
    expect(
      (
        await second.inject({
          method: 'POST',
          url: `/api/tasks/${taskId}/start`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(202);

    // The resumed run opens a second graph run and inherits the finished nodes.
    await until(
      () => graphRuns(dataDir).length > runsAfterBoot.length,
      'the resumed run to be recorded',
    );
    await until(
      () =>
        nodeRuns(dataDir).filter((run) => run.node === 'planner' && run.state === 'completed')
          .length > plannersBefore.filter((run) => run.node === 'planner').length,
      'the planners to be carried into the resumed run',
    );

    // The R5 exit criterion. The planners' turns were sent to a provider before
    // the crash; the resumed run inherits them as marker rows rather than
    // invoking again, so nothing is paid for twice.
    expect(invocationsPerNode(dataDir)['planner']).toBe(billedBefore['planner']);
    expect(invocationsPerNode(dataDir)['planner_tests']).toBe(billedBefore['planner_tests']);
  });

  it('leaves a projectable history on both sides of the restart', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rf-restart-hist-'));
    cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
    const repoDir = await repository();

    const first = await bootDaemon(dataDir);
    const project = await first.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: { path: repoDir },
    });
    const task = await first.inject({
      method: 'POST',
      url: '/api/tasks',
      headers,
      payload: {
        projectId: (project.json() as { id: string }).id,
        type: 'bug_fix',
        title: 'Fix README typo',
        brief: 'README is incomplete',
        expectedBehaviour: 'Has fix note',
        actualBehaviour: 'Missing fix note',
      },
    });
    const taskId = (task.json() as { id: string }).id;
    await authoriseTaskContract(first, headers, taskId);
    await first.inject({ method: 'POST', url: `/api/tasks/${taskId}/start`, headers, payload: {} });
    await waitFor(first, '/api/approvals', (body) => Array.isArray(body) && body.length > 0);
    await first.close();

    const second = await bootDaemon(dataDir);
    cleanup.push(async () => {
      await second.close();
    });

    const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
    const runs = db.prepare('SELECT id FROM graph_runs').all() as Array<{ id: string }>;
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      // The reducer refuses a contradictory history, so a run cut short mid
      // flight still has to project — an interrupted run is not an excuse for
      // an incoherent one.
      const projected = loadGraphRun(db, run.id);
      expect(projected?.runId).toBe(run.id);
      expect(projected?.nodes.some((node) => node.outcome === 'completed')).toBe(true);
    }
    db.close();
  });
});

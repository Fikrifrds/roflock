import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMigratedDatabase } from '@roleflock/database';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * R5: a repair budget that survives the process, recorded durably.
 *
 * The runtime side is covered in `graph-runtime`. What this pins is the storage
 * contract the daemon depends on to resume: attempts are rows, they are counted
 * per graph run, and a run that starts fresh cannot see another run's spend.
 */

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function database() {
  const directory = mkdtempSync(join(tmpdir(), 'roflock-loop-'));
  directories.push(directory);
  return openMigratedDatabase(join(directory, 'test.db'));
}

/** Minimal rows for one graph run with a node that looped `attempts` times. */
function seedRun(
  db: ReturnType<typeof openMigratedDatabase>,
  runId: string,
  attempts: number,
  state = 'interrupted',
) {
  const at = new Date().toISOString();
  db.prepare(
    'INSERT INTO graph_runs (id, task_id, graph_version_id, state, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(runId, 'task_1', 'bug_fix@3', state, at, at);
  db.prepare(
    'INSERT INTO node_runs (id, graph_run_id, node_key, state, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(`${runId}_node`, runId, 'test', 'completed', at, at);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    db.prepare(
      'INSERT INTO loop_attempts (id, node_run_id, attempt, state, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(`${runId}_a${attempt}`, `${runId}_node`, attempt, 'taken', at);
  }
}

function spentOn(db: ReturnType<typeof openMigratedDatabase>, runId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM loop_attempts
         WHERE node_run_id IN (SELECT id FROM node_runs WHERE graph_run_id = ?)`,
      )
      .get(runId) as { count: number }
  ).count;
}

describe('durable repair budget', () => {
  it('counts the re-entries a previous run already paid for', () => {
    const db = database();
    seedRun(db, 'run_1', 2);

    expect(spentOn(db, 'run_1')).toBe(2);
  });

  it('does not leak spend between separate runs of the same task', () => {
    const db = database();
    seedRun(db, 'run_1', 3);
    seedRun(db, 'run_2', 0);

    // A user starting the task over gets a whole budget; only a *resumed* run
    // inherits what was spent.
    expect(spentOn(db, 'run_2')).toBe(0);
  });

  it('reports nothing spent for a run that never looped', () => {
    const db = database();
    seedRun(db, 'run_1', 0);

    expect(spentOn(db, 'run_1')).toBe(0);
  });

  it('survives the daemon reopening the database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'roflock-loop-'));
    directories.push(directory);
    const path = join(directory, 'test.db');

    const first = openMigratedDatabase(path);
    seedRun(first, 'run_1', 2);
    first.close();

    // The whole point: the budget is in the file, not in the process that spent it.
    const second = openMigratedDatabase(path);
    expect(spentOn(second, 'run_1')).toBe(2);
    second.close();
  });

  it('keeps attempts attached to their node run so evidence survives', () => {
    const db = database();
    seedRun(db, 'run_1', 2);

    const rows = db
      .prepare('SELECT attempt, state FROM loop_attempts ORDER BY attempt')
      .all() as Array<{ attempt: number; state: string }>;

    expect(rows).toEqual([
      { attempt: 1, state: 'taken' },
      { attempt: 2, state: 'taken' },
    ]);
  });
});

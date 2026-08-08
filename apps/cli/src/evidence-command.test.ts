import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMigratedDatabase } from '@roleflock/database';
import { afterEach, describe, expect, it } from 'vitest';
import { ExitCode } from './exit-codes.js';
import { runCli } from './main.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function dataDir(seed?: (db: ReturnType<typeof openMigratedDatabase>) => void): string {
  const directory = mkdtempSync(join(tmpdir(), 'roflock-evidence-'));
  directories.push(directory);
  const db = openMigratedDatabase(join(directory, 'roleflock.db'));
  seed?.(db);
  db.close();
  return directory;
}

function run(argv: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runCli(argv, {
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

const AT = '2026-08-08T10:00:00.000Z';

function seedRun(db: ReturnType<typeof openMigratedDatabase>, taskId: string) {
  db.prepare(
    'INSERT INTO graph_runs (id, task_id, graph_version_id, state, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('run_1', taskId, 'bug_fix@3', 'completed', AT, AT);
}

describe('roflock evidence', () => {
  it('names every link in the chain, including the ones with nothing behind them', () => {
    const directory = dataDir((db) => seedRun(db, 'task_1'));
    const result = run(['evidence', 'task_1', '--data-dir', directory]);

    expect(result.code).toBe(ExitCode.Ok);
    // A run missing its verification step must not read like a run that needed
    // none, so every question appears whether or not it was answered.
    expect(result.stdout).toContain('What was authorised?');
    expect(result.stdout).toContain('What was verified, and did it pass?');
    expect(result.stdout).toContain('Who accepted it?');
    expect(result.stdout).toContain('Missing:');
    expect(result.stdout).toContain('An absent record is not evidence of absence of a problem.');
  });

  it('reports the graph run and the version it executed', () => {
    const directory = dataDir((db) => seedRun(db, 'task_1'));

    expect(run(['evidence', 'task_1', '--data-dir', directory]).stdout).toContain('bug_fix@3');
  });

  it('emits machine-readable output on request', () => {
    const directory = dataDir((db) => seedRun(db, 'task_1'));
    const result = run(['evidence', 'task_1', '--json', '--data-dir', directory]);

    const parsed = JSON.parse(result.stdout) as {
      complete: boolean;
      steps: Array<{ id: string; status: string }>;
      gaps: string[];
    };
    expect(parsed.complete).toBe(false);
    expect(parsed.steps.map((step) => step.id)).toEqual([
      'contract',
      'plan',
      'artefacts',
      'verification',
      'review',
      'approval',
      'disclosure',
    ]);
    expect(parsed.gaps.length).toBeGreaterThan(0);
  });

  it('succeeds even when the chain has holes', () => {
    const directory = dataDir((db) => seedRun(db, 'task_1'));

    // Gaps are the answer, not a command failure. Exiting non-zero would make a
    // script treat an honest report as a broken tool.
    expect(run(['evidence', 'task_1', '--data-dir', directory]).code).toBe(ExitCode.Ok);
  });

  it('says so when there is no run at all', () => {
    const directory = dataDir();

    expect(run(['evidence', 'unknown_task', '--data-dir', directory]).stdout).toContain(
      'no graph run recorded',
    );
  });

  it('separates a missing database from a missing run', () => {
    const result = run(['evidence', 'task_1', '--data-dir', join(tmpdir(), 'roflock-absent')]);

    expect(result.code).toBe(ExitCode.Config);
    expect(result.stderr).toContain('No Roflock database');
  });

  it('keeps JSON failures machine-readable', () => {
    const result = run([
      'evidence',
      'task_1',
      '--json',
      '--data-dir',
      join(tmpdir(), 'roflock-absent'),
    ]);

    expect(result.code).toBe(ExitCode.Config);
    expect(JSON.parse(result.stderr)).toMatchObject({ exitCode: ExitCode.Config });
    expect(result.stdout).toBe('');
  });

  it('rejects ignored files and extra task IDs', () => {
    expect(run(['evidence', 'task_1', '--file', 'ignored']).code).toBe(ExitCode.Usage);
    expect(run(['evidence', 'task_1', 'task_2']).code).toBe(ExitCode.Usage);
  });

  it('rejects being given no task', () => {
    expect(run(['evidence']).code).toBe(ExitCode.Usage);
  });
});

describe('roflock why', () => {
  it('requires a file', () => {
    const directory = dataDir((db) => seedRun(db, 'task_1'));
    const result = run(['why', 'task_1', '--data-dir', directory]);

    expect(result.code).toBe(ExitCode.Usage);
    expect(result.stderr).toContain('--file');
  });

  it('returns a JSON usage envelope when requested', () => {
    const result = run(['why', 'task_1', '--json']);

    expect(result.code).toBe(ExitCode.Usage);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: 'USAGE' },
      exitCode: ExitCode.Usage,
    });
  });

  it('distinguishes no recorded output from no history', () => {
    const directory = dataDir((db) => seedRun(db, 'task_1'));
    const result = run(['why', 'task_1', '--file', 'src/payment.ts', '--data-dir', directory]);

    expect(result.code).toBe(ExitCode.Ok);
    // Says what it knows rather than what it guesses.
    expect(result.stdout).toContain('No recorded output for src/payment.ts');
  });
});

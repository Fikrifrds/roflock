import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExitCode } from './exit-codes.js';
import { runEvents, runStatus } from './runtime-inspection-command.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function sessionDir() {
  const directory = mkdtempSync(join(tmpdir(), 'roflock-inspect-cli-'));
  directories.push(directory);
  writeFileSync(
    join(directory, 'session.json'),
    JSON.stringify({ token: 't'.repeat(32), csrf: 'c'.repeat(16) }),
  );
  return directory;
}

function output() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
    stdout,
    stderr,
  };
}

describe('runtime inspection commands', () => {
  it('prints a durable status projection and supports exact JSON', async () => {
    const directory = sessionDir();
    const projection = {
      id: 'run_1',
      taskId: 'task_1',
      graphVersionId: 'release@3',
      state: 'running',
      createdAt: '2026-08-09T00:00:00.000Z',
      nodeCounts: { completed: 2, running: 1 },
    };
    const fetchMock = (async () =>
      new Response(JSON.stringify(projection), { status: 200 })) as typeof fetch;
    const human = output();
    expect(
      await runStatus(['run_1'], human.io, {
        clientOptions: { dataDir: directory, fetch: fetchMock },
      }),
    ).toBe(ExitCode.Ok);
    expect(human.stdout.join('\n')).toContain('run_1  running');
    expect(human.stdout.join('\n')).toContain('completed=2');

    const json = output();
    expect(
      await runStatus(['run_1', '--json'], json.io, {
        clientOptions: { dataDir: directory, fetch: fetchMock },
      }),
    ).toBe(ExitCode.Ok);
    expect(JSON.parse(json.stdout[0]!)).toEqual(projection);
  });

  it('requests events after an exact sequence and prints ordered envelopes', async () => {
    const directory = sessionDir();
    let requested = '';
    const events = [
      {
        id: 'event_1',
        aggregateType: 'graph_run',
        aggregateId: 'run_1',
        sequence: 5,
        eventType: 'node.completed',
        payload: { nodeId: 'Build' },
        metadata: { schemaVersion: 1 },
        createdAt: '2026-08-09T00:00:00.000Z',
      },
    ];
    const fetchMock = (async (url: string | URL | Request) => {
      requested = String(url);
      return new Response(JSON.stringify(events), { status: 200 });
    }) as typeof fetch;
    const result = output();

    expect(
      await runEvents(['run_1', '--after', '4'], result.io, {
        clientOptions: { dataDir: directory, fetch: fetchMock },
      }),
    ).toBe(ExitCode.Ok);
    expect(requested).toContain('/api/runs/run_1/events?after=4');
    expect(result.stdout[0]).toContain('5\t2026-08-09T00:00:00.000Z\tnode.completed');
    expect(result.stdout[0]).toContain('"nodeId":"Build"');
  });

  it('rejects invalid cursors and reports missing runs', async () => {
    const invalid = output();
    expect(await runEvents(['run_1', '--after', '-1'], invalid.io)).toBe(ExitCode.Usage);

    const directory = sessionDir();
    const missing = output();
    const fetchMock = (async () =>
      new Response(JSON.stringify({ error: 'Run not found' }), { status: 404 })) as typeof fetch;
    expect(
      await runStatus(['missing'], missing.io, {
        clientOptions: { dataDir: directory, fetch: fetchMock },
      }),
    ).toBe(ExitCode.Usage);
    expect(missing.stderr).toEqual(['Run not found']);
  });
});

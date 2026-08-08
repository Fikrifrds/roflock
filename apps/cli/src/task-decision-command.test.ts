import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExitCode } from './exit-codes.js';
import { runTaskDecision } from './task-decision-command.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'roflock-task-decision-'));
  directories.push(dataDir);
  writeFileSync(
    join(dataDir, 'session.json'),
    JSON.stringify({ token: 't'.repeat(32), csrf: 'c'.repeat(16) }),
  );
  return dataDir;
}

function capture() {
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

describe('terminal task decisions', () => {
  it.each([
    ['accept-task', 'accept', 'accepted'],
    ['reject-task', 'reject', 'rejected'],
  ] as const)('posts %s to the exact task', async (command, endpoint, decision) => {
    const dataDir = fixture();
    const output = capture();
    const requests: string[] = [];
    const fetchMock = (async (url: string | URL | Request) => {
      requests.push(String(url));
      return new Response(JSON.stringify({ accepted: true, taskId: 'task/1', decision }), {
        status: 200,
      });
    }) as typeof fetch;

    const code = await runTaskDecision(command, ['task/1', '--json'], output.io, {
      clientOptions: { dataDir, fetch: fetchMock },
    });

    expect(code).toBe(ExitCode.Ok);
    expect(requests).toEqual([`http://127.0.0.1:4178/api/tasks/task%2F1/${endpoint}`]);
    expect(JSON.parse(output.stdout[0]!)).toMatchObject({ taskId: 'task/1', decision });
    expect(output.stderr).toEqual([]);
  });

  it('rejects a missing task id before contacting the daemon', async () => {
    const output = capture();

    expect(await runTaskDecision('accept-task', [], output.io)).toBe(ExitCode.Usage);
    expect(output.stderr[0]).toContain('Usage: roflock accept-task <task-id>');
  });

  it('maps a task in the wrong state to blocked JSON output', async () => {
    const dataDir = fixture();
    const output = capture();
    const fetchMock = (async () =>
      new Response(
        JSON.stringify({
          code: 'TASK_NOT_AWAITING_ACCEPTANCE',
          error: 'Task is running, not awaiting acceptance',
        }),
        { status: 409 },
      )) as typeof fetch;

    const code = await runTaskDecision('accept-task', ['task_1', '--json'], output.io, {
      clientOptions: { dataDir, fetch: fetchMock },
    });

    expect(code).toBe(ExitCode.Blocked);
    expect(output.stdout).toEqual([]);
    expect(JSON.parse(output.stderr[0]!)).toMatchObject({
      error: { code: 'TASK_NOT_AWAITING_ACCEPTANCE', httpStatus: 409 },
      exitCode: ExitCode.Blocked,
    });
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExitCode } from './exit-codes.js';
import { runControl, type RuntimeControl } from './runtime-control-command.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'roflock-control-cli-'));
  directories.push(directory);
  writeFileSync(
    join(directory, 'session.json'),
    JSON.stringify({ token: 't'.repeat(32), csrf: 'c'.repeat(16) }),
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    directory,
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
    stdout,
    stderr,
  };
}

describe('runtime control commands', () => {
  it.each(['pause', 'resume', 'cancel'] as RuntimeControl[])(
    'sends %s to the exact run-scoped endpoint',
    async (command) => {
      const test = fixture();
      let request: { url: string; method?: string } | undefined;
      const response =
        command === 'resume'
          ? { accepted: true, graphRunId: 'run_1' }
          : command === 'cancel'
            ? {
                accepted: true,
                cancellation: {
                  capability: 'local-process-only',
                  confirmable: false,
                  activeTurns: 1,
                  stopped: false,
                  results: [],
                },
              }
            : { accepted: true };
      const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
        request = { url: String(url), method: init?.method };
        return new Response(JSON.stringify(response), { status: 200 });
      }) as typeof fetch;

      expect(
        await runControl(command, ['run_1'], test.io, {
          clientOptions: { dataDir: test.directory, fetch: fetchMock },
        }),
      ).toBe(ExitCode.Ok);
      expect(request).toEqual({
        url: `http://127.0.0.1:4178/api/runs/run_1/${command}`,
        method: 'POST',
      });
      expect(test.stdout[0]).toContain(`${command} accepted`);
      if (command === 'cancel') {
        expect(test.stdout.join('\n')).toContain('not remotely confirmed');
      }
    },
  );

  it('maps a historical-run conflict to blocked', async () => {
    const test = fixture();
    const fetchMock = (async () =>
      new Response(JSON.stringify({ error: 'Run is historical' }), {
        status: 409,
      })) as typeof fetch;
    expect(
      await runControl('pause', ['old_run'], test.io, {
        clientOptions: { dataDir: test.directory, fetch: fetchMock },
      }),
    ).toBe(ExitCode.Blocked);
    expect(test.stderr).toEqual(['Run is historical']);
  });

  it('requires an exact run id', async () => {
    const test = fixture();
    expect(await runControl('cancel', [], test.io)).toBe(ExitCode.Usage);
    expect(test.stderr[0]).toContain('roflock cancel <run-id>');
  });
});

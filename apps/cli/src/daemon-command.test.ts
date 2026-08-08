import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDaemonCommand } from './daemon-command.js';
import { ExitCode } from './exit-codes.js';

const directories: string[] = [];
afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'roflock-daemon-command-'));
  directories.push(dataDir);
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    dataDir,
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
    stdout,
    stderr,
  };
}

describe('daemon command', () => {
  it('reports an existing daemon without needing a packaged entry', async () => {
    const test = fixture();
    expect(
      await runDaemonCommand(['start', '--json'], test.io, {
        lifecycleOptions: {
          dataDir: test.dataDir,
          fetch: (async () =>
            new Response(JSON.stringify({ ok: true, service: 'roleflock-daemon' }), {
              status: 200,
            })) as typeof fetch,
        },
      }),
    ).toBe(ExitCode.Ok);
    expect(JSON.parse(test.stdout[0]!)).toMatchObject({
      state: 'running',
      ownership: 'external',
    });
  });

  it('returns configuration failure when an owned daemon artifact is missing', async () => {
    const test = fixture();
    expect(
      await runDaemonCommand(['start', '--json'], test.io, {
        lifecycleOptions: {
          dataDir: test.dataDir,
          daemonEntry: join(test.dataDir, 'missing.js'),
          fetch: (async () => {
            throw new Error('offline');
          }) as typeof fetch,
        },
      }),
    ).toBe(ExitCode.Config);
    expect(JSON.parse(test.stderr[0]!).exitCode).toBe(ExitCode.Config);
  });

  it('validates lifecycle actions before touching local state', async () => {
    const test = fixture();
    expect(await runDaemonCommand(['restart'], test.io)).toBe(ExitCode.Usage);
    expect(test.stderr[0]).toContain('start|status|stop');
  });
});

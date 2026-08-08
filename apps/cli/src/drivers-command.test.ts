import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExitCode } from './exit-codes.js';
import { projectDriverStatus, runDrivers } from './drivers-command.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'roflock-drivers-'));
  directories.push(dataDir);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'session.json'), JSON.stringify({ token: 'token', csrf: 'csrf' }));
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    dataDir,
    stdout,
    stderr,
    io: { stdout: (v: string) => stdout.push(v), stderr: (v: string) => stderr.push(v) },
  };
}

describe('driver status contract', () => {
  it('does not confuse detection with authentication or runnability', () => {
    expect(
      projectDriverStatus({
        id: 'codex',
        displayName: 'Codex CLI',
        status: 'unauthenticated',
        health: { status: 'unauthenticated', binary: '/bin/codex' },
        connectionType: 'cli',
        account: { loggedIn: false },
      }),
    ).toMatchObject({ installed: true, detected: true, authenticated: false, runnable: false });
  });

  it('returns driver failure when none of the detected drivers is runnable', async () => {
    const test = fixture();
    const code = await runDrivers(['doctor', '--json'], test.io, {
      clientOptions: {
        dataDir: test.dataDir,
        fetch: (async (url: string | URL | Request) => {
          expect(String(url)).toContain('/api/providers?fresh=1');
          return new Response(
            JSON.stringify([
              {
                id: 'codex',
                displayName: 'Codex CLI',
                status: 'missing',
                health: { status: 'missing' },
                connectionType: 'cli',
                account: { loggedIn: false },
              },
            ]),
          );
        }) as typeof fetch,
      },
    });

    expect(code).toBe(ExitCode.Driver);
    expect(JSON.parse(test.stdout[0]!)).toMatchObject({
      drivers: [{ installed: false, detected: true, authenticated: false, runnable: false }],
    });
    expect(test.stderr).toEqual([]);
  });
});

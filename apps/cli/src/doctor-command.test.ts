import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectDoctorReport, runDoctor } from './doctor-command.js';
import { ExitCode } from './exit-codes.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

function dataDirectory() {
  const value = mkdtempSync(join(tmpdir(), 'roflock-doctor-'));
  directories.push(value);
  mkdirSync(value, { recursive: true });
  writeFileSync(join(value, 'session.json'), JSON.stringify({ token: 'token', csrf: 'csrf' }));
  return value;
}

describe('roflock doctor', () => {
  it('is ready only when repository, worktrees, daemon, auth, and runnability are proven', async () => {
    const dataDir = dataDirectory();
    const report = await collectDoctorReport(
      { json: true, dataDir },
      {
        cwd: '/repo',
        nodeVersion: 'v24.1.0',
        roflockVersion: '0.1.0',
        lifecycle: {
          status: async () => ({
            state: 'running',
            ownership: 'owned',
            baseUrl: 'http://127.0.0.1:4178',
            dataDir,
          }),
        },
        runCommand: async (_file, args) => ({
          stdout: args[0] === '--version' ? 'git version 2.50.0' : '/repo',
        }),
        clientOptions: {
          dataDir,
          fetch: (async () =>
            new Response(
              JSON.stringify([
                {
                  id: 'codex',
                  displayName: 'Codex CLI',
                  status: 'ready',
                  health: { status: 'ready', binary: '/bin/codex' },
                  connectionType: 'cli',
                  account: { loggedIn: true },
                },
              ]),
            )) as typeof fetch,
        },
      },
    );

    expect(report.ready).toBe(true);
    expect(report.drivers[0]).toMatchObject({ authenticated: true, runnable: true });
  });

  it('returns a configuration failure and structured diagnostics when prerequisites are absent', async () => {
    const stdout: string[] = [];
    const code = await runDoctor(
      ['--json'],
      { stdout: (value) => stdout.push(value), stderr: () => {} },
      {
        cwd: '/not-a-repo',
        nodeVersion: 'v22.0.0',
        roflockVersion: '0.1.0',
        runCommand: async () => {
          throw new Error('missing');
        },
        lifecycle: {
          status: async () => ({
            state: 'stopped',
            ownership: 'none',
            baseUrl: 'http://127.0.0.1:4178',
            dataDir: '/tmp/none',
          }),
        },
      },
    );

    expect(code).toBe(ExitCode.Config);
    expect(JSON.parse(stdout[0]!)).toMatchObject({ ready: false });
  });
});

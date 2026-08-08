import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExitCode } from './exit-codes.js';
import { runStudio } from './studio-command.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'roflock-studio-'));
  directories.push(dataDir);
  writeFileSync(
    join(dataDir, 'session.json'),
    JSON.stringify({ token: 'private token', csrf: 'x' }),
  );
  return dataDir;
}

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    sink: {
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
    },
    stdout,
    stderr,
  };
}

describe('roflock studio', () => {
  it('starts the daemon and prints the private Studio handoff URL', async () => {
    const dataDir = fixture();
    const output = io();
    const code = await runStudio([], output.sink, {
      lifecycle: {
        start: async () => ({
          state: 'running',
          ownership: 'owned',
          baseUrl: 'http://127.0.0.1:4178',
          dataDir,
        }),
      },
    });

    expect(code).toBe(ExitCode.Ok);
    expect(output.stdout.join('\n')).toContain('http://127.0.0.1:4178/?rft=private%20token');
    expect(output.stderr.join('\n')).toContain('Keep this URL private');
  });

  it('returns one JSON document when requested', async () => {
    const dataDir = fixture();
    const output = io();
    const code = await runStudio(['--json'], output.sink, {
      lifecycle: {
        start: async () => ({
          state: 'running',
          ownership: 'external',
          baseUrl: 'http://127.0.0.1:4210',
          dataDir,
        }),
      },
    });

    expect(code).toBe(ExitCode.Ok);
    expect(JSON.parse(output.stdout.join('\n'))).toMatchObject({
      baseUrl: 'http://127.0.0.1:4210',
      ownership: 'external',
    });
    expect(output.stderr).toEqual([]);
  });
});

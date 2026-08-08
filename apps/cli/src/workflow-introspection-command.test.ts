import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExitCode } from './exit-codes.js';
import { runDryRun, runExplain } from './workflow-introspection-command.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function workflow(): string {
  const directory = mkdtempSync(join(tmpdir(), 'roflock-introspect-'));
  directories.push(directory);
  const file = join(directory, 'demo.roflock');
  writeFileSync(
    file,
    'workflow Demo { version "1.0.0" description "A demo" } role writer { write } agent Build { role writer objective "Build" retry 2 } check Tests { run "node --version" required } human Accept { title "Accept" decisions approve, reject } flow { Build -> Tests Tests.pass -> Accept }',
  );
  return file;
}

function output() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
    stdout,
    stderr,
  };
}

describe('workflow introspection commands', () => {
  it('explains compiled roles, gates, and semantic identity', () => {
    const result = output();

    expect(runExplain([workflow(), '--json'], result.io)).toBe(ExitCode.Ok);
    expect(JSON.parse(result.stdout[0]!)).toMatchObject({
      workflow: { id: 'Demo', version: '1.0.0' },
      roles: ['writer'],
      safeguards: { writers: ['Build'], requiredChecks: ['Tests'], humanGates: ['Accept'] },
    });
  });

  it('dry-runs the compiler without claiming that execution started', () => {
    const result = output();

    expect(runDryRun([workflow(), '--json'], result.io)).toBe(ExitCode.Ok);
    expect(JSON.parse(result.stdout[0]!)).toMatchObject({ dryRun: true, executionStarted: false });
  });

  it('rejects invalid workflows and unknown options', () => {
    const invalid = output();
    expect(runDryRun(['missing.roflock'], invalid.io)).toBe(ExitCode.Usage);

    const usage = output();
    expect(runExplain([workflow(), '--daemon-url', 'http://localhost'], usage.io)).toBe(
      ExitCode.Usage,
    );
  });
});

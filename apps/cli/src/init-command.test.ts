import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile } from '@roleflock/language';
import { afterEach, describe, expect, it } from 'vitest';
import { ExitCode } from './exit-codes.js';
import { initializeProject, runInit } from './init-command.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

function directory() {
  const value = mkdtempSync(join(tmpdir(), 'roflock-init-'));
  directories.push(value);
  return value;
}

describe('roflock init', () => {
  it('creates a valid credential-free project scaffold idempotently', () => {
    const root = directory();
    const first = initializeProject(root);
    const workflowPath = join(root, '.roflock', 'workflows', 'bugfix.roflock');
    const profile = readFileSync(join(root, '.roflock', 'profiles', 'local.toml'), 'utf8');

    expect(first.created).toHaveLength(4);
    expect(compile(readFileSync(workflowPath, 'utf8'), { uri: workflowPath }).ir).toBeDefined();
    expect(profile).not.toMatch(/api[_-]?key|token|secret\s*=/i);

    const second = initializeProject(root);
    expect(second).toMatchObject({ created: [], conflicts: [] });
    expect(second.unchanged).toHaveLength(4);
  });

  it('fails closed without modifying any file when one target conflicts', () => {
    const root = directory();
    initializeProject(root);
    const conflict = join(root, '.roflock', 'roflock.toml');
    const workflow = join(root, '.roflock', 'workflows', 'bugfix.roflock');
    const originalWorkflow = readFileSync(workflow, 'utf8');
    writeFileSync(conflict, 'user-owned = true\n');
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = runInit(
      ['--json'],
      { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) },
      { cwd: root },
    );

    expect(code).toBe(ExitCode.Blocked);
    expect(JSON.parse(stdout[0]!).conflicts).toEqual(['roflock.toml']);
    expect(stderr).toEqual([]);
    expect(readFileSync(workflow, 'utf8')).toBe(originalWorkflow);
    expect(readFileSync(conflict, 'utf8')).toBe('user-owned = true\n');
  });
});

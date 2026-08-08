import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExitCode } from './exit-codes.js';
import {
  installWorkflowPackage,
  runWorkflowPackage,
  verifyWorkflowPackage,
} from './workflow-package-command.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'roflock-workflow-package-'));
  directories.push(root);
  const source = join(root, 'source');
  const project = join(root, 'project');
  const manifest = {
    schemaVersion: 1,
    name: 'demo-workflows',
    version: '1.2.3',
    workflows: ['workflows/demo.roflock'],
  };
  mkdirSync(join(source, 'workflows'), { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(source, 'roflock.workflow.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    join(source, 'workflows/demo.roflock'),
    'workflow Demo { version "1.0.0" } role reviewer { readonly } agent Review { role reviewer objective "Review" } human Accept { title "Accept" decisions approve, reject } flow { Review -> Accept }',
  );
  return { source, project };
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

describe('local workflow packages', () => {
  it('validates a manifest and produces a stable source integrity hash', () => {
    const { source } = workspace();
    const first = verifyWorkflowPackage(source);
    const second = verifyWorkflowPackage(source);

    expect(first.integrity).toMatch(/^[a-f0-9]{64}$/);
    expect(second.integrity).toBe(first.integrity);
    expect(first.files).toMatchObject([{ path: 'workflows/demo.roflock', workflowId: 'Demo' }]);
  });

  it('installs only declared source files and locks an idempotent identity', () => {
    const { source, project } = workspace();
    writeFileSync(join(source, 'untrusted.sh'), 'echo should-not-copy');

    const first = installWorkflowPackage(source, project);
    const second = installWorkflowPackage(source, project);
    const lock = JSON.parse(
      readFileSync(join(project, '.roflock/roflock-workflows.lock.json'), 'utf8'),
    );

    expect(first.installed).toBe(true);
    expect(second.installed).toBe(false);
    expect(readFileSync(join(first.target, 'workflows/demo.roflock'), 'utf8')).toContain(
      'workflow Demo',
    );
    expect(() => readFileSync(join(first.target, 'untrusted.sh'), 'utf8')).toThrow();
    expect(lock.packages['demo-workflows']).toMatchObject({
      version: '1.2.3',
      integrity: first.package.integrity,
    });
    expect(readdirSync(join(project, '.roflock/packages'))).not.toContainEqual(
      expect.stringMatching(/^\.install-/),
    );
    expect(readdirSync(join(project, '.roflock'))).not.toContainEqual(
      expect.stringMatching(/^\.roflock-workflows\.lock\.json\..*\.tmp$/),
    );
  });

  it('surfaces package validation and list output through the CLI namespace', () => {
    const { source, project } = workspace();
    const validated = output();
    expect(runWorkflowPackage(['validate', source, '--json'], validated.io)).toBe(ExitCode.Ok);
    expect(JSON.parse(validated.stdout[0]!)).toMatchObject({ valid: true, name: 'demo-workflows' });

    const installed = output();
    expect(runWorkflowPackage(['install', source, '--project', project], installed.io)).toBe(
      ExitCode.Ok,
    );
    const listed = output();
    expect(runWorkflowPackage(['list', '--project', project, '--json'], listed.io)).toBe(
      ExitCode.Ok,
    );
    expect(JSON.parse(listed.stdout[0]!)).toMatchObject({
      packages: [{ name: 'demo-workflows', version: '1.2.3' }],
    });
  });

  it('refuses paths that escape the package and conflicting lock entries', () => {
    const { source, project } = workspace();
    writeFileSync(
      join(source, 'roflock.workflow.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: 'demo-workflows',
        version: '1.2.3',
        workflows: ['../outside.roflock'],
      }),
    );
    expect(() => verifyWorkflowPackage(source)).toThrow('escapes the package');

    const command = output();
    expect(runWorkflowPackage(['install', source, '--project', project], command.io)).toBe(
      ExitCode.Usage,
    );
  });

  it('refuses a symlinked workflow even when it resolves inside the package', () => {
    const { source } = workspace();
    const original = join(source, 'workflows/demo.roflock');
    const alias = join(source, 'workflows/alias.roflock');
    symlinkSync(original, alias);
    writeFileSync(
      join(source, 'roflock.workflow.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: 'demo-workflows',
        version: '1.2.3',
        workflows: ['workflows/alias.roflock'],
      }),
    );

    expect(() => verifyWorkflowPackage(source)).toThrow('not a symlink');
  });
});

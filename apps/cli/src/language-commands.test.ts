import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExitCode } from './exit-codes.js';
import { runCli } from './main.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function workspace(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'roflock-cli-'));
  directories.push(directory);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(directory, name), content);
  }
  return directory;
}

function run(argv: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runCli(argv, {
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

const VALID = `
workflow Demo {
  version "1.0.0"
  max_cost 5
}
role implementer { write }
agent Builder { role implementer }
check Tests { run "npm test" required }
human Accept
flow {
  Builder -> Tests
  Tests.pass -> Accept
  Tests.fail -> Builder { max 2 }
}
`;

const BROKEN = `
role implementer { write }
agent Builder { role implementer }
human Accept
flow { Builder.nonsense -> Accept }
`;

describe('roflock check', () => {
  it('reports a valid workflow on stdout and succeeds', () => {
    const dir = workspace({ 'demo.roflock': VALID });
    const result = run(['check', join(dir, 'demo.roflock')]);

    expect(result.code).toBe(ExitCode.Ok);
    expect(result.stdout).toContain('ok — 3 nodes');
    expect(result.stdout).toMatch(/sha256:[0-9a-f]{64}/);
  });

  it('reports diagnostics on stderr and exits with the validation code', () => {
    const dir = workspace({ 'broken.roflock': BROKEN });
    const result = run(['check', join(dir, 'broken.roflock')]);

    expect(result.code).toBe(ExitCode.Usage);
    expect(result.stderr).toContain('RF121');
    // stdout stays clean so a script can branch on the exit code alone.
    expect(result.stdout).toBe('');
  });

  it('separates a missing file from an invalid one', () => {
    const dir = workspace({});
    const result = run(['check', join(dir, 'absent.roflock')]);

    // A file that is not there is a configuration problem, not a bad workflow.
    expect(result.code).toBe(ExitCode.Config);
    expect(result.stderr).toContain('Cannot read');
  });

  it('rejects being given no file', () => {
    expect(run(['check']).code).toBe(ExitCode.Usage);
  });
});

describe('roflock compile', () => {
  it('writes canonical IR to a file', () => {
    const dir = workspace({ 'demo.roflock': VALID });
    const out = join(dir, 'demo.ir.json');
    const result = run(['compile', join(dir, 'demo.roflock'), '-o', out]);

    expect(result.code).toBe(ExitCode.Ok);
    const ir = JSON.parse(readFileSync(out, 'utf8')) as {
      irVersion: string;
      nodes: Array<{ id: string }>;
      loops: unknown[];
    };
    expect(ir.irVersion).toBe('1.0');
    expect(ir.nodes.map((n) => n.id)).toEqual(['Accept', 'Builder', 'Tests']);
    expect(ir.loops).toHaveLength(1);
  });

  it('prints IR to stdout when no output file is given', () => {
    const dir = workspace({ 'demo.roflock': VALID });
    const result = run(['compile', join(dir, 'demo.roflock')]);

    expect(result.code).toBe(ExitCode.Ok);
    // Parsing its own stdout is the point: `roflock compile x | jq` must work.
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it('emits no IR for an invalid workflow', () => {
    const dir = workspace({ 'broken.roflock': BROKEN });
    const result = run(['compile', join(dir, 'broken.roflock')]);

    expect(result.code).toBe(ExitCode.Usage);
    expect(result.stdout).toBe('');
  });
});

describe('roflock validate-ir', () => {
  it('accepts IR the compiler produced', () => {
    const dir = workspace({ 'demo.roflock': VALID });
    const out = join(dir, 'demo.ir.json');
    run(['compile', join(dir, 'demo.roflock'), '-o', out]);

    const result = run(['validate-ir', out]);

    expect(result.code).toBe(ExitCode.Ok);
    expect(result.stdout).toContain('ok');
  });

  it('rejects IR whose stamped hash no longer matches its content', () => {
    const dir = workspace({ 'demo.roflock': VALID });
    const out = join(dir, 'demo.ir.json');
    run(['compile', join(dir, 'demo.roflock'), '-o', out]);

    const document = JSON.parse(readFileSync(out, 'utf8')) as {
      nodes: Array<{ id: string; check?: { operation: string } }>;
    };
    const tests = document.nodes.find((node) => node.id === 'Tests')!;
    tests.check!.operation = 'echo "always passes"';
    writeFileSync(out, JSON.stringify(document));

    const result = run(['validate-ir', out]);

    // Swapping the verification command out from under a stamped identity is
    // exactly the tamper this check exists to catch.
    expect(result.code).toBe(ExitCode.Usage);
    expect(result.stderr).toContain('does not match its content');
  });

  it('rejects a structurally invalid document', () => {
    const dir = workspace({
      'bad.ir.json': JSON.stringify({
        irVersion: '1.0',
        kind: 'roflock.graph',
        workflow: { id: 'x', name: 'x', version: '1', entryNodeIds: [], terminalNodeIds: [] },
        goals: [],
        artifacts: [],
        roles: [],
        nodes: [],
        edges: [],
        loops: [],
        policies: {},
        profiles: [],
      }),
    });
    const result = run(['validate-ir', join(dir, 'bad.ir.json')]);

    expect(result.code).toBe(ExitCode.Usage);
    expect(result.stderr).toContain('RF203');
  });

  it('rejects a file that is not JSON', () => {
    const dir = workspace({ 'nope.json': 'not json at all' });
    const result = run(['validate-ir', join(dir, 'nope.json')]);

    expect(result.code).toBe(ExitCode.Usage);
    expect(result.stderr).toContain('not valid JSON');
  });
});

describe('roflock hash', () => {
  it('agrees with the hash stamped into compiled IR', () => {
    const dir = workspace({ 'demo.roflock': VALID });
    const out = join(dir, 'demo.ir.json');
    run(['compile', join(dir, 'demo.roflock'), '-o', out]);
    const stamped = (
      JSON.parse(readFileSync(out, 'utf8')) as { workflow: { semanticHash: string } }
    ).workflow.semanticHash;

    const fromSource = run(['hash', join(dir, 'demo.roflock')]);
    const fromIr = run(['hash', out]);

    expect(fromSource.stdout).toBe(stamped);
    expect(fromIr.stdout).toBe(stamped);
  });

  it('is unchanged by reformatting the source', () => {
    const dir = workspace({
      'a.roflock': VALID,
      'b.roflock': VALID.replace(/\n/g, '\n\n'),
    });

    expect(run(['hash', join(dir, 'a.roflock')]).stdout).toBe(
      run(['hash', join(dir, 'b.roflock')]).stdout,
    );
  });
});

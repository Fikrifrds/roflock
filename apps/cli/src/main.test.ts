import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ExitCode } from './exit-codes.js';
import { cliVersion, runCli } from './main.js';

function run(argv: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runCli(argv, {
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

describe('roflock CLI', () => {
  it('prints help and succeeds when invoked with no arguments', () => {
    const result = run([]);

    expect(result.code).toBe(ExitCode.Ok);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('roflock <command>');
    // Bare invocation is a discovery action, not a mistake, so help belongs on
    // stdout where it can be piped.
    expect(result.stdout).toContain('passport verify');
  });

  it.each(['--help', '-h', 'help'])('accepts %s as a help request', (flag) => {
    const result = run([flag]);

    expect(result.code).toBe(ExitCode.Ok);
    expect(result.stdout).toContain('Usage');
  });

  it.each(['--version', '-v', 'version'])('reports the package version via %s', (flag) => {
    const result = run([flag]);

    expect(result.code).toBe(ExitCode.Ok);
    expect(result.stdout).toBe(cliVersion());
  });

  it('reports the version recorded in the package manifest', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    // Guards against a hard-coded constant drifting from the published artifact.
    expect(cliVersion()).toBe(manifest.version);
  });

  it('rejects an unknown command with the usage exit code and a pointer to help', () => {
    const result = run(['definitely-not-a-command']);

    expect(result.code).toBe(ExitCode.Usage);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown command: definitely-not-a-command');
    expect(result.stderr).toContain('roflock --help');
  });

  it('routes passport arguments through to the passport command', () => {
    // No passport file supplied, so this must surface the passport command's own
    // usage error rather than the dispatcher's unknown-command error.
    const result = run(['passport']);

    expect(result.code).toBe(ExitCode.Usage);
    expect(result.stderr).toContain('passport verify');
  });

  it('keeps every documented exit code distinct', () => {
    const codes = Object.values(ExitCode);

    expect(new Set(codes).size).toBe(codes.length);
    expect(ExitCode.Ok).toBe(0);
  });
});

import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { relative } from 'node:path';

export interface CommandSpec {
  command: string;
  args?: string[];
  cwd: string;
  sandboxRoot: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  input?: string;
}
export interface CommandResult {
  command: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}
export class CommandError extends Error {
  constructor(public readonly result: CommandResult) {
    super(`Command failed: ${result.command} (${result.exitCode})`);
  }
}
export async function runCommand(spec: CommandSpec): Promise<CommandResult> {
  const [cwd, root] = await Promise.all([realpath(spec.cwd), realpath(spec.sandboxRoot)]);
  if (relative(root, cwd).startsWith('..')) throw new Error(`cwd escapes sandbox root: ${cwd}`);
  return new Promise((resolveResult, reject) => {
    const child = spawn(spec.command, spec.args ?? [], {
      cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stdout = '',
      stderr = '',
      timedOut = false;
    child.stdout.on('data', (d: Buffer) => {
      stdout += d;
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d;
    });
    if (spec.input) child.stdin.end(spec.input);
    else child.stdin.end();
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, spec.timeoutMs ?? 60_000);
    child.on('error', reject);
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      const result = {
        command: spec.command,
        args: spec.args ?? [],
        cwd,
        stdout,
        stderr,
        exitCode,
        timedOut,
      };
      if (timedOut || exitCode !== 0) reject(new CommandError(result));
      else resolveResult(result);
    });
  });
}

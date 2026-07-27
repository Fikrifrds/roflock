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
  /** Fired for each stdout/stderr chunk so a live view can stream the turn. */
  onChunk?: (stream: 'stdout' | 'stderr', chunk: string) => void;
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
    super(
      result.timedOut
        ? `Command timed out: ${result.command}`
        : `Command failed: ${result.command} (${result.exitCode})`,
    );
  }
}

/** Parse a command field into argv without invoking a shell or expanding variables. */
export function parseCommandArgv(input: string): [string, ...string[]] {
  const args: string[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let started = false;

  for (const char of input.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      started = true;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      started = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        args.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }

  if (escaped) throw new Error('Verification command ends with an incomplete escape.');
  if (quote) throw new Error('Verification command contains an unmatched quote.');
  if (started) args.push(current);
  if (!args[0]) throw new Error('Verification command is empty.');
  return args as [string, ...string[]];
}

const MAX_CAPTURE_CHARS = 2 * 1024 * 1024;

function appendCapture(current: string, chunk: string): string {
  const combined = current + chunk;
  if (combined.length <= MAX_CAPTURE_CHARS) return combined;
  return `[output truncated; retaining last ${MAX_CAPTURE_CHARS} characters]\n${combined.slice(
    -MAX_CAPTURE_CHARS,
  )}`;
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
      timedOut = false,
      closed = false;
    child.stdout.on('data', (d: Buffer) => {
      const chunk = String(d);
      stdout = appendCapture(stdout, chunk);
      spec.onChunk?.('stdout', chunk);
    });
    child.stderr.on('data', (d: Buffer) => {
      const chunk = String(d);
      stderr = appendCapture(stderr, chunk);
      spec.onChunk?.('stderr', chunk);
    });
    if (spec.input) child.stdin.end(spec.input);
    else child.stdin.end();
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      } else {
        child.kill('SIGTERM');
      }
      const killTimer = setTimeout(() => {
        if (closed) return;
        if (child.pid && process.platform !== 'win32') {
          try {
            process.kill(-child.pid, 'SIGKILL');
            return;
          } catch {
            // Fall through to direct child termination.
          }
        }
        child.kill('SIGKILL');
      }, 2_000);
      killTimer.unref();
    }, spec.timeoutMs ?? 60_000);
    child.on('error', (error) => {
      closed = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode) => {
      closed = true;
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

import { describe, expect, it } from 'vitest';
import { DaemonApiError } from './daemon-client.js';
import { ExitCode } from './exit-codes.js';
import { emitRuntimeError, emitUsageError, exitCodeForRun } from './runtime-output.js';

function output() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
    stdout,
    stderr,
  };
}

describe('runtime output contract', () => {
  it.each([
    ['running', undefined, ExitCode.Ok],
    ['completed', undefined, ExitCode.Ok],
    ['accepted', undefined, ExitCode.Ok],
    ['failed', undefined, ExitCode.RunFailed],
    ['rejected', undefined, ExitCode.RunFailed],
    ['paused', undefined, ExitCode.Blocked],
    ['awaiting_confirmation', undefined, ExitCode.Blocked],
    ['awaiting_acceptance', undefined, ExitCode.Blocked],
    ['cancelled', undefined, ExitCode.Cancelled],
    ['stopping', undefined, ExitCode.Cancelled],
    ['interrupted', 'setup_required', ExitCode.Driver],
    ['interrupted', 'provider_unavailable', ExitCode.Driver],
    ['interrupted', 'outcome_unknown', ExitCode.Driver],
    ['interrupted', undefined, ExitCode.Cancelled],
    ['future_daemon_state', undefined, ExitCode.Internal],
  ] as const)('maps %s / %s to exit %s', (state, reason, expected) => {
    expect(exitCodeForRun(state, reason)).toBe(expected);
  });

  it('emits one JSON error object on stderr with its exit code', () => {
    const result = output();
    const code = emitRuntimeError(
      new DaemonApiError('No provider', 422, {
        code: 'RUN_START_FAILED',
        error: 'No provider',
      }),
      result.io,
      true,
    );

    expect(code).toBe(ExitCode.Driver);
    expect(result.stdout).toEqual([]);
    expect(JSON.parse(result.stderr[0]!)).toEqual({
      error: { message: 'No provider', code: 'RUN_START_FAILED', httpStatus: 422 },
      exitCode: ExitCode.Driver,
    });
  });

  it('keeps usage failures machine-readable when --json is present', () => {
    const result = output();
    expect(emitUsageError('missing id', ['--json'], result.io)).toBe(ExitCode.Usage);
    expect(JSON.parse(result.stderr[0]!)).toEqual({
      error: { message: 'missing id', code: 'USAGE' },
      exitCode: ExitCode.Usage,
    });
  });

  it('maps bad daemon input to usage instead of an internal Roflock fault', () => {
    const result = output();
    const code = emitRuntimeError(
      new DaemonApiError('after must be non-negative', 400, {
        error: 'after must be non-negative',
      }),
      result.io,
      true,
    );

    expect(code).toBe(ExitCode.Usage);
    expect(JSON.parse(result.stderr[0]!)).toMatchObject({ exitCode: ExitCode.Usage });
  });
});

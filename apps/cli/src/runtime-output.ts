import { DaemonApiError } from './daemon-client.js';
import { ExitCode } from './exit-codes.js';
import type { CliIo } from './main.js';

export function exitCodeForRun(state: string, blockedReason?: string): number {
  if (state === 'running' || state === 'completed' || state === 'accepted') return ExitCode.Ok;
  if (state === 'failed' || state === 'rejected') return ExitCode.RunFailed;
  if (state === 'cancelled' || state === 'stopping') return ExitCode.Cancelled;
  if (state === 'interrupted') {
    return blockedReason ? ExitCode.Driver : ExitCode.Cancelled;
  }
  if (
    state === 'paused' ||
    state === 'awaiting_confirmation' ||
    state === 'awaiting_acceptance' ||
    state === 'ready' ||
    state === 'draft'
  ) {
    return ExitCode.Blocked;
  }
  // A newly introduced state is not success until its automation meaning is
  // deliberately assigned. Failing closed prevents an upgraded daemon from
  // making an older CLI tell CI that an unknown result passed.
  return ExitCode.Internal;
}

export function emitRuntimeError(
  error: unknown,
  io: CliIo,
  json: boolean,
  fallback: number = ExitCode.Internal,
): number {
  const message = error instanceof Error ? error.message : 'Runtime command failed';
  let exitCode: number = fallback;
  let httpStatus: number | undefined;
  let code: string | undefined;
  if (error instanceof DaemonApiError) {
    httpStatus = error.status || undefined;
    if (error.body && typeof error.body === 'object' && 'code' in error.body) {
      code = String((error.body as { code: unknown }).code);
    }
    if (error.status === 0 || error.status === 401 || error.status === 403) {
      exitCode = ExitCode.Config;
    } else if (error.status === 400 || error.status === 404) exitCode = ExitCode.Usage;
    else if (error.status === 409) exitCode = ExitCode.Blocked;
    else if (error.status === 422) {
      exitCode = code === 'RUN_START_FAILED' ? ExitCode.Driver : ExitCode.Usage;
    }
  }
  if (json) {
    io.stderr(
      JSON.stringify({
        error: {
          message,
          ...(code === undefined ? {} : { code }),
          ...(httpStatus === undefined ? {} : { httpStatus }),
        },
        exitCode,
      }),
    );
  } else io.stderr(message);
  return exitCode;
}

export function emitUsageError(message: string, args: string[], io: CliIo): number {
  if (args.includes('--json')) {
    io.stderr(JSON.stringify({ error: { message, code: 'USAGE' }, exitCode: ExitCode.Usage }));
  } else io.stderr(message);
  return ExitCode.Usage;
}

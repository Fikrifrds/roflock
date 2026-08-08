import { DaemonClient, type DaemonClientOptions } from './daemon-client.js';
import { ExitCode } from './exit-codes.js';
import type { CliIo } from './main.js';
import { emitRuntimeError, emitUsageError } from './runtime-output.js';

export type RuntimeControl = 'pause' | 'resume' | 'cancel';

interface ControlOptions {
  runId: string;
  json: boolean;
  daemonUrl?: string;
  dataDir?: string;
}

interface ControlResult {
  accepted: true;
  graphRunId?: string;
  cancellation?: {
    capability: string;
    confirmable: boolean;
    activeTurns: number;
    stopped: boolean;
    results: Array<{ stopped: boolean; capability: string; detail?: string }>;
  };
}

class UsageError extends Error {}

function parse(args: string[], command: RuntimeControl): ControlOptions {
  const positional: string[] = [];
  let json = false;
  let daemonUrl: string | undefined;
  let dataDir: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--json') json = true;
    else if (arg === '--daemon-url' || arg === '--data-dir') {
      const value = args[index + 1];
      if (!value) throw new UsageError(`${arg} needs a value`);
      index += 1;
      if (arg === '--daemon-url') daemonUrl = value;
      else dataDir = value;
    } else if (arg.startsWith('-')) throw new UsageError(`Unknown option '${arg}'`);
    else positional.push(arg);
  }
  if (positional.length !== 1) {
    throw new UsageError(`Usage: roflock ${command} <run-id> [--json]`);
  }
  return {
    runId: positional[0]!,
    json,
    ...(daemonUrl === undefined ? {} : { daemonUrl }),
    ...(dataDir === undefined ? {} : { dataDir }),
  };
}

export async function runControl(
  command: RuntimeControl,
  args: string[],
  io: CliIo,
  dependencies: { clientOptions?: DaemonClientOptions } = {},
): Promise<number> {
  let options: ControlOptions;
  try {
    options = parse(args, command);
  } catch (error) {
    return emitUsageError((error as Error).message, args, io);
  }
  const client = new DaemonClient({
    ...dependencies.clientOptions,
    ...(options.daemonUrl === undefined ? {} : { baseUrl: options.daemonUrl }),
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
  });
  try {
    const result = await client.request<ControlResult>(
      'POST',
      `/api/runs/${encodeURIComponent(options.runId)}/${command}`,
      {},
    );
    if (options.json) io.stdout(JSON.stringify(result));
    else {
      io.stdout(`${command} accepted for run ${options.runId}.`);
      if (command === 'resume' && result.graphRunId) {
        io.stdout(`Active run: ${result.graphRunId}`);
      }
      if (result.cancellation) {
        const certainty = result.cancellation.stopped
          ? 'remote stop confirmed'
          : result.cancellation.activeTurns === 0
            ? 'no active provider turn to confirm'
            : `stop is not remotely confirmed (${result.cancellation.capability})`;
        io.stdout(`Cancellation: ${certainty}.`);
      }
    }
    return ExitCode.Ok;
  } catch (error) {
    return emitRuntimeError(error, io, options.json);
  }
}

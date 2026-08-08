import { DaemonClient, type DaemonClientOptions } from './daemon-client.js';
import { ExitCode } from './exit-codes.js';
import type { CliIo } from './main.js';
import { emitRuntimeError, emitUsageError } from './runtime-output.js';

export type TaskDecisionCommand = 'accept-task' | 'reject-task';

interface Options {
  taskId: string;
  json: boolean;
  daemonUrl?: string;
  dataDir?: string;
}

class UsageError extends Error {}

function parse(command: TaskDecisionCommand, args: string[]): Options {
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
    throw new UsageError(`Usage: roflock ${command} <task-id> [--json]`);
  }
  return {
    taskId: positional[0]!,
    json,
    ...(daemonUrl === undefined ? {} : { daemonUrl }),
    ...(dataDir === undefined ? {} : { dataDir }),
  };
}

export async function runTaskDecision(
  command: TaskDecisionCommand,
  args: string[],
  io: CliIo,
  dependencies: { clientOptions?: DaemonClientOptions } = {},
): Promise<number> {
  let options: Options;
  try {
    options = parse(command, args);
  } catch (error) {
    return emitUsageError((error as Error).message, args, io);
  }

  const client = new DaemonClient({
    ...dependencies.clientOptions,
    ...(options.daemonUrl === undefined ? {} : { baseUrl: options.daemonUrl }),
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
  });
  const decision = command === 'accept-task' ? 'accept' : 'reject';
  try {
    const result = await client.request<{
      accepted: true;
      taskId: string;
      decision: 'accepted' | 'rejected';
    }>('POST', `/api/tasks/${encodeURIComponent(options.taskId)}/${decision}`, {});
    if (options.json) io.stdout(JSON.stringify(result));
    else io.stdout(`Task ${result.taskId} ${result.decision}.`);
    return ExitCode.Ok;
  } catch (error) {
    return emitRuntimeError(error, io, options.json);
  }
}

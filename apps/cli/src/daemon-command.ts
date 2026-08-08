import { DaemonLifecycle, type DaemonLifecycleOptions } from './daemon-lifecycle.js';
import { ExitCode } from './exit-codes.js';
import type { CliIo } from './main.js';
import { emitRuntimeError, emitUsageError } from './runtime-output.js';

type DaemonAction = 'start' | 'status' | 'stop';

interface Options {
  action: DaemonAction;
  json: boolean;
  daemonUrl?: string;
  dataDir?: string;
}

class UsageError extends Error {}

function parse(args: string[]): Options {
  const action = args[0];
  if (action !== 'start' && action !== 'status' && action !== 'stop') {
    throw new UsageError('Usage: roflock daemon <start|status|stop> [--json]');
  }
  let json = false;
  let daemonUrl: string | undefined;
  let dataDir: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--json') json = true;
    else if (arg === '--daemon-url' || arg === '--data-dir') {
      const value = args[index + 1];
      if (!value) throw new UsageError(`${arg} needs a value`);
      index += 1;
      if (arg === '--daemon-url') daemonUrl = value;
      else dataDir = value;
    } else throw new UsageError(`Unknown option '${arg}'`);
  }
  return {
    action,
    json,
    ...(daemonUrl === undefined ? {} : { daemonUrl }),
    ...(dataDir === undefined ? {} : { dataDir }),
  };
}

export async function runDaemonCommand(
  args: string[],
  io: CliIo,
  dependencies: { lifecycleOptions?: DaemonLifecycleOptions } = {},
): Promise<number> {
  let options: Options;
  try {
    options = parse(args);
  } catch (error) {
    return emitUsageError((error as Error).message, args, io);
  }
  const lifecycle = new DaemonLifecycle({
    ...dependencies.lifecycleOptions,
    ...(options.daemonUrl === undefined ? {} : { baseUrl: options.daemonUrl }),
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
  });
  try {
    const status = await lifecycle[options.action]();
    if (options.json) io.stdout(JSON.stringify(status));
    else if (status.state === 'running') {
      io.stdout(
        status.ownership === 'owned'
          ? `CLI-owned daemon ${status.pid} is running at ${status.baseUrl}.`
          : `Connected to ${status.ownership} daemon at ${status.baseUrl}.`,
      );
    } else io.stdout(`Daemon is stopped at ${status.baseUrl}.`);
    return ExitCode.Ok;
  } catch (error) {
    return emitRuntimeError(
      error,
      io,
      options.json,
      options.action === 'stop' ? ExitCode.Blocked : ExitCode.Config,
    );
  }
}

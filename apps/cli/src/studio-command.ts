import { readDaemonSession } from './daemon-client.js';
import { DaemonLifecycle, type DaemonLifecycleOptions } from './daemon-lifecycle.js';
import { ExitCode } from './exit-codes.js';
import type { CliIo } from './main.js';
import { emitRuntimeError, emitUsageError } from './runtime-output.js';

interface Options {
  json: boolean;
  daemonUrl?: string;
  dataDir?: string;
}

class UsageError extends Error {}

function parse(args: string[]): Options {
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
    } else throw new UsageError(`Unknown option '${arg}'`);
  }
  return {
    json,
    ...(daemonUrl === undefined ? {} : { daemonUrl }),
    ...(dataDir === undefined ? {} : { dataDir }),
  };
}

export async function runStudio(
  args: string[],
  io: CliIo,
  dependencies: {
    lifecycle?: Pick<DaemonLifecycle, 'start'>;
    lifecycleOptions?: DaemonLifecycleOptions;
  } = {},
): Promise<number> {
  let options: Options;
  try {
    options = parse(args);
  } catch (error) {
    return emitUsageError(`${(error as Error).message}\nUsage: roflock studio [--json]`, args, io);
  }

  const lifecycleOptions = {
    ...dependencies.lifecycleOptions,
    ...(options.daemonUrl === undefined ? {} : { baseUrl: options.daemonUrl }),
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
  };
  const lifecycle = dependencies.lifecycle ?? new DaemonLifecycle(lifecycleOptions);
  try {
    const status = await lifecycle.start();
    const session = readDaemonSession(status.dataDir);
    const url = `${status.baseUrl}/?rft=${encodeURIComponent(session.token)}`;
    if (options.json) {
      io.stdout(
        JSON.stringify({
          url,
          baseUrl: status.baseUrl,
          dataDir: status.dataDir,
          ownership: status.ownership,
        }),
      );
    } else {
      io.stdout(`Open Roflock Studio: ${url}`);
      io.stderr('Keep this URL private — it grants control of the local daemon.');
    }
    return ExitCode.Ok;
  } catch (error) {
    return emitRuntimeError(error, io, options.json, ExitCode.Config);
  }
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DaemonClient, type DaemonClientOptions } from './daemon-client.js';
import { ExitCode } from './exit-codes.js';
import type { CliIo } from './main.js';
import { emitRuntimeError, emitUsageError } from './runtime-output.js';

interface RunOptions {
  workflow: string;
  repository: string;
  brief: string;
  title?: string;
  json: boolean;
  daemonUrl?: string;
  dataDir?: string;
}

interface StartedRun {
  accepted: true;
  taskId: string;
  graphRunId: string;
  workflowId: string;
  semanticHash: string;
  contract?: { mode: string; warning: string };
}

class UsageError extends Error {}

function parseRunArgs(args: string[]): RunOptions {
  const positional: string[] = [];
  let repository: string | undefined;
  let brief: string | undefined;
  let title: string | undefined;
  let daemonUrl: string | undefined;
  let dataDir: string | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--json') json = true;
    else if (['--repo', '--brief', '--title', '--daemon-url', '--data-dir'].includes(arg)) {
      const value = args[index + 1];
      if (!value) throw new UsageError(`${arg} needs a value`);
      index += 1;
      if (arg === '--repo') repository = value;
      else if (arg === '--brief') brief = value;
      else if (arg === '--title') title = value;
      else if (arg === '--daemon-url') daemonUrl = value;
      else dataDir = value;
    } else if (arg.startsWith('-')) throw new UsageError(`Unknown option '${arg}'`);
    else positional.push(arg);
  }
  if (positional.length !== 1 || !repository || !brief) {
    throw new UsageError(
      'Usage: roflock run <workflow.roflock> --repo <path> --brief <text> [--title <text>] [--json]',
    );
  }
  return {
    workflow: positional[0]!,
    repository,
    brief,
    json,
    ...(title === undefined ? {} : { title }),
    ...(daemonUrl === undefined ? {} : { daemonUrl }),
    ...(dataDir === undefined ? {} : { dataDir }),
  };
}

export async function runWorkflow(
  args: string[],
  io: CliIo,
  dependencies: { clientOptions?: DaemonClientOptions } = {},
): Promise<number> {
  let options: RunOptions;
  try {
    options = parseRunArgs(args);
  } catch (error) {
    return emitUsageError((error as Error).message, args, io);
  }

  let source: string;
  try {
    source = readFileSync(options.workflow, 'utf8');
  } catch {
    return emitRuntimeError(
      new Error(`Cannot read '${options.workflow}'`),
      io,
      options.json,
      ExitCode.Config,
    );
  }

  const client = new DaemonClient({
    ...dependencies.clientOptions,
    ...(options.daemonUrl === undefined ? {} : { baseUrl: options.daemonUrl }),
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
  });
  try {
    const project = await client.request<{ id: string }>('POST', '/api/projects', {
      path: resolve(options.repository),
    });
    const started = await client.request<StartedRun>('POST', '/api/runtime/runs', {
      projectId: project.id,
      source,
      title: options.title,
      brief: options.brief,
      allowUncontracted: true,
    });
    if (options.json) io.stdout(JSON.stringify(started));
    else {
      io.stdout(`Run ${started.graphRunId} started for workflow ${started.workflowId}.`);
      io.stdout(`Task: ${started.taskId}`);
      io.stdout(`Semantic hash: ${started.semanticHash}`);
      if (started.contract?.warning) io.stderr(`warning: ${started.contract.warning}`);
    }
    return ExitCode.Ok;
  } catch (error) {
    return emitRuntimeError(error, io, options.json);
  }
}

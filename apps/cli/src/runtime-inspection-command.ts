import { DaemonClient, type DaemonClientOptions } from './daemon-client.js';
import { ExitCode } from './exit-codes.js';
import type { CliIo } from './main.js';
import { emitRuntimeError, emitUsageError, exitCodeForRun } from './runtime-output.js';

export interface RunProjection {
  id: string;
  taskId: string;
  graphVersionId: string;
  state: string;
  taskState?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  blockedRole?: string;
  blockedReason?: string;
  blockedDetail?: string;
  nodeCounts: Record<string, number>;
}

export interface RunEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  sequence: number;
  eventType: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface InspectionOptions {
  runId: string;
  json: boolean;
  after: number;
  daemonUrl?: string;
  dataDir?: string;
}

class UsageError extends Error {}

function parse(args: string[], command: 'status' | 'events'): InspectionOptions {
  const positional: string[] = [];
  let json = false;
  let after = 0;
  let daemonUrl: string | undefined;
  let dataDir: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--json') json = true;
    else if (['--after', '--daemon-url', '--data-dir'].includes(arg)) {
      if (arg === '--after' && command !== 'events') {
        throw new UsageError("Option '--after' is only valid for events");
      }
      const value = args[index + 1];
      if (!value) throw new UsageError(`${arg} needs a value`);
      index += 1;
      if (arg === '--after') {
        after = Number(value);
        if (!Number.isInteger(after) || after < 0) {
          throw new UsageError('--after must be a non-negative integer');
        }
      } else if (arg === '--daemon-url') daemonUrl = value;
      else dataDir = value;
    } else if (arg.startsWith('-')) throw new UsageError(`Unknown option '${arg}'`);
    else positional.push(arg);
  }
  if (positional.length !== 1) {
    throw new UsageError(
      `Usage: roflock ${command} <run-id>${command === 'events' ? ' [--after <sequence>]' : ''} [--json]`,
    );
  }
  return {
    runId: positional[0]!,
    json,
    after,
    ...(daemonUrl === undefined ? {} : { daemonUrl }),
    ...(dataDir === undefined ? {} : { dataDir }),
  };
}

function clientFor(
  options: InspectionOptions,
  dependencies: { clientOptions?: DaemonClientOptions },
): DaemonClient {
  return new DaemonClient({
    ...dependencies.clientOptions,
    ...(options.daemonUrl === undefined ? {} : { baseUrl: options.daemonUrl }),
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
  });
}

export async function runStatus(
  args: string[],
  io: CliIo,
  dependencies: { clientOptions?: DaemonClientOptions } = {},
): Promise<number> {
  let options: InspectionOptions;
  try {
    options = parse(args, 'status');
  } catch (error) {
    return emitUsageError((error as Error).message, args, io);
  }
  try {
    const projection = await clientFor(options, dependencies).request<RunProjection>(
      'GET',
      `/api/runs/${encodeURIComponent(options.runId)}`,
    );
    if (options.json) io.stdout(JSON.stringify(projection));
    else {
      io.stdout(`${projection.id}  ${projection.state}`);
      io.stdout(`Task: ${projection.taskId}`);
      if (projection.taskState && projection.taskState !== projection.state) {
        io.stdout(`Task state: ${projection.taskState}`);
      }
      io.stdout(`Workflow: ${projection.graphVersionId}`);
      const counts = Object.entries(projection.nodeCounts)
        .map(([state, count]) => `${state}=${count}`)
        .join(', ');
      if (counts) io.stdout(`Nodes: ${counts}`);
      if (projection.blockedReason) {
        io.stderr(
          `blocked${projection.blockedRole ? ` (${projection.blockedRole})` : ''}: ${projection.blockedReason}${projection.blockedDetail ? ` — ${projection.blockedDetail}` : ''}`,
        );
      }
    }
    return exitCodeForRun(projection.taskState ?? projection.state, projection.blockedReason);
  } catch (error) {
    return emitRuntimeError(error, io, options.json);
  }
}

export async function runEvents(
  args: string[],
  io: CliIo,
  dependencies: { clientOptions?: DaemonClientOptions } = {},
): Promise<number> {
  let options: InspectionOptions;
  try {
    options = parse(args, 'events');
  } catch (error) {
    return emitUsageError((error as Error).message, args, io);
  }
  try {
    const runEvents = await clientFor(options, dependencies).request<RunEvent[]>(
      'GET',
      `/api/runs/${encodeURIComponent(options.runId)}/events?after=${options.after}`,
    );
    if (options.json) io.stdout(JSON.stringify(runEvents));
    else if (runEvents.length === 0) io.stdout(`No events after sequence ${options.after}.`);
    else {
      for (const event of runEvents) {
        const payload = Object.keys(event.payload).length
          ? ` ${JSON.stringify(event.payload)}`
          : '';
        io.stdout(`${event.sequence}\t${event.createdAt}\t${event.eventType}${payload}`);
      }
    }
    return ExitCode.Ok;
  } catch (error) {
    return emitRuntimeError(error, io, options.json);
  }
}

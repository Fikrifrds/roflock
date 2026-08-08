import { DaemonClient, type DaemonClientOptions } from './daemon-client.js';
import { ExitCode } from './exit-codes.js';
import type { CliIo } from './main.js';
import { emitRuntimeError, emitUsageError } from './runtime-output.js';

export interface Approval {
  id: string;
  taskId: string;
  graphRunId: string;
  nodeRunId: string;
  requestType: string;
  rationale: string;
  exactAction: Record<string, unknown>;
  affectedPaths?: string[];
  commandPreview?: string;
  destination?: string;
  estimatedAdditionalCost?: number;
  riskClass: string;
  stateHash: string;
  fingerprint: string;
  status: string;
  createdAt: string;
}

type ApprovalCommand = 'approvals' | 'approval' | 'approve' | 'reject';

interface Options {
  id?: string;
  runId?: string;
  taskId?: string;
  json: boolean;
  daemonUrl?: string;
  dataDir?: string;
}

class UsageError extends Error {}

function parse(command: ApprovalCommand, args: string[]): Options {
  const positional: string[] = [];
  let runId: string | undefined;
  let taskId: string | undefined;
  let daemonUrl: string | undefined;
  let dataDir: string | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--json') json = true;
    else if (['--run', '--task', '--daemon-url', '--data-dir'].includes(arg)) {
      if (command !== 'approvals' && (arg === '--run' || arg === '--task')) {
        throw new UsageError(`${arg} is only valid for 'roflock approvals'`);
      }
      const value = args[index + 1];
      if (!value) throw new UsageError(`${arg} needs a value`);
      index += 1;
      if (arg === '--run') runId = value;
      else if (arg === '--task') taskId = value;
      else if (arg === '--daemon-url') daemonUrl = value;
      else dataDir = value;
    } else if (arg.startsWith('-')) throw new UsageError(`Unknown option '${arg}'`);
    else positional.push(arg);
  }
  const needsId = command !== 'approvals';
  if ((needsId && positional.length !== 1) || (!needsId && positional.length !== 0)) {
    throw new UsageError(
      needsId
        ? `Usage: roflock ${command} <approval-id> [--json]`
        : 'Usage: roflock approvals [--run <run-id> | --task <task-id>] [--json]',
    );
  }
  return {
    ...(positional[0] === undefined ? {} : { id: positional[0] }),
    ...(runId === undefined ? {} : { runId }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(daemonUrl === undefined ? {} : { daemonUrl }),
    ...(dataDir === undefined ? {} : { dataDir }),
    json,
  };
}

function show(approval: Approval, io: CliIo): void {
  io.stdout(`${approval.id}  ${approval.status}  ${approval.riskClass}`);
  io.stdout(`Run: ${approval.graphRunId}  Task: ${approval.taskId}`);
  io.stdout(`Request: ${approval.requestType} — ${approval.rationale}`);
  io.stdout(`Action: ${JSON.stringify(approval.exactAction)}`);
  if (approval.affectedPaths?.length) io.stdout(`Paths: ${approval.affectedPaths.join(', ')}`);
  if (approval.commandPreview) io.stdout(`Command: ${approval.commandPreview}`);
  if (approval.destination) io.stdout(`Destination: ${approval.destination}`);
}

export async function runApprovalCommand(
  command: ApprovalCommand,
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

  try {
    if (command === 'approvals') {
      const query = new URLSearchParams();
      if (options.runId) query.set('runId', options.runId);
      if (options.taskId) query.set('taskId', options.taskId);
      const approvals = await client.request<Approval[]>(
        'GET',
        `/api/approvals${query.size ? `?${query}` : ''}`,
      );
      if (options.json) io.stdout(JSON.stringify(approvals));
      else if (approvals.length === 0) io.stdout('No pending approvals.');
      else {
        for (const approval of approvals) {
          io.stdout(
            `${approval.id}\t${approval.riskClass}\t${approval.requestType}\t${approval.rationale}`,
          );
        }
      }
      return approvals.length > 0 ? ExitCode.Blocked : ExitCode.Ok;
    }

    if (command === 'approval') {
      const approval = await client.request<Approval>(
        'GET',
        `/api/approvals/${encodeURIComponent(options.id!)}`,
      );
      if (options.json) io.stdout(JSON.stringify(approval));
      else show(approval, io);
      return approval.status === 'pending' ? ExitCode.Blocked : ExitCode.Ok;
    }

    const result = await client.request<{ accepted: true; approval: Approval }>(
      'POST',
      `/api/approvals/${encodeURIComponent(options.id!)}/${command}`,
      {},
    );
    if (options.json) io.stdout(JSON.stringify(result));
    else io.stdout(`Approval ${options.id} ${result.approval.status}.`);
    return ExitCode.Ok;
  } catch (error) {
    return emitRuntimeError(error, io, options.json);
  }
}

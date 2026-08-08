import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DaemonClient, type DaemonClientOptions } from './daemon-client.js';
import { DaemonLifecycle, type DaemonLifecycleStatus } from './daemon-lifecycle.js';
import {
  projectDriverStatus,
  type DriverStatus,
  type ProviderInventoryItem,
} from './drivers-command.js';
import { ExitCode } from './exit-codes.js';
import { cliVersion, type CliIo } from './main.js';
import { emitRuntimeError, emitUsageError } from './runtime-output.js';

const execFileAsync = promisify(execFile);

type CheckState = 'ready' | 'warning' | 'missing' | 'invalid' | 'stopped';

export interface DoctorCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
}

export interface DoctorReport {
  ready: boolean;
  checks: DoctorCheck[];
  drivers: DriverStatus[];
}

interface Options {
  json: boolean;
  daemonUrl?: string;
  dataDir?: string;
}

interface DoctorDependencies {
  clientOptions?: DaemonClientOptions;
  lifecycle?: Pick<DaemonLifecycle, 'status'>;
  runCommand?: (file: string, args: string[], cwd: string) => Promise<{ stdout: string }>;
  cwd?: string;
  nodeVersion?: string;
  roflockVersion?: string;
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

function renderCheck(check: DoctorCheck): string {
  return `${check.label.padEnd(20)} ${check.state}${check.detail ? ` · ${check.detail}` : ''}`;
}

function nodeCheck(version: string): DoctorCheck {
  const major = Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '', 10);
  const ready = Number.isInteger(major) && major >= 24;
  return {
    id: 'node',
    label: 'Node',
    state: ready ? 'ready' : 'invalid',
    detail: `${version}${ready ? '' : ' (Node 24+ required)'}`,
  };
}

export async function collectDoctorReport(
  options: Options,
  dependencies: DoctorDependencies = {},
): Promise<DoctorReport> {
  const cwd = dependencies.cwd ?? process.cwd();
  const runCommand =
    dependencies.runCommand ??
    (async (file, args, commandCwd) => execFileAsync(file, args, { cwd: commandCwd }));
  const lifecycleOptions = {
    ...dependencies.clientOptions,
    ...(options.daemonUrl === undefined ? {} : { baseUrl: options.daemonUrl }),
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
  };
  const checks: DoctorCheck[] = [
    {
      id: 'roflock',
      label: 'Roflock',
      state: 'ready',
      detail: dependencies.roflockVersion ?? cliVersion(),
    },
    nodeCheck(dependencies.nodeVersion ?? process.version),
  ];

  let gitReady = false;
  try {
    const result = await runCommand('git', ['--version'], cwd);
    gitReady = true;
    checks.push({ id: 'git', label: 'Git', state: 'ready', detail: result.stdout.trim() });
  } catch {
    checks.push({ id: 'git', label: 'Git', state: 'missing', detail: 'git was not found on PATH' });
  }

  let repositoryReady = false;
  let worktreeReady = false;
  if (gitReady) {
    try {
      const root = await runCommand('git', ['rev-parse', '--show-toplevel'], cwd);
      repositoryReady = true;
      checks.push({
        id: 'repository',
        label: 'Repository',
        state: 'ready',
        detail: root.stdout.trim(),
      });
      await runCommand('git', ['worktree', 'list', '--porcelain'], cwd);
      worktreeReady = true;
      checks.push({
        id: 'worktree',
        label: 'Worktree support',
        state: 'ready',
        detail: 'git worktree available',
      });
    } catch {
      checks.push({
        id: 'repository',
        label: 'Repository',
        state: 'invalid',
        detail: 'current directory is not a usable Git worktree',
      });
      checks.push({
        id: 'worktree',
        label: 'Worktree support',
        state: 'invalid',
        detail: 'not verified',
      });
    }
  }

  const lifecycle = dependencies.lifecycle ?? new DaemonLifecycle(lifecycleOptions);
  let daemon: DaemonLifecycleStatus;
  try {
    daemon = await lifecycle.status();
    checks.push({
      id: 'daemon',
      label: 'Local daemon',
      state: daemon.state === 'running' ? 'ready' : 'stopped',
      detail:
        daemon.state === 'running'
          ? `${daemon.ownership} at ${daemon.baseUrl}`
          : `not running at ${daemon.baseUrl}`,
    });
  } catch (error) {
    daemon = { state: 'stopped', ownership: 'none', baseUrl: '', dataDir: '' };
    checks.push({
      id: 'daemon',
      label: 'Local daemon',
      state: 'invalid',
      detail: error instanceof Error ? error.message : 'status check failed',
    });
  }

  let drivers: DriverStatus[] = [];
  if (daemon.state === 'running') {
    const client = new DaemonClient(lifecycleOptions);
    try {
      const providers = await client.request<ProviderInventoryItem[]>(
        'GET',
        '/api/providers?fresh=1',
      );
      drivers = providers.map(projectDriverStatus);
    } catch (error) {
      checks.push({
        id: 'drivers',
        label: 'Drivers',
        state: 'invalid',
        detail: error instanceof Error ? error.message : 'inventory failed',
      });
    }
  }
  const runnableDrivers = drivers.filter((driver) => driver.runnable).length;
  if (!checks.some((check) => check.id === 'drivers')) {
    checks.push({
      id: 'drivers',
      label: 'Drivers',
      state: runnableDrivers > 0 ? 'ready' : daemon.state === 'running' ? 'warning' : 'stopped',
      detail:
        runnableDrivers > 0
          ? `${runnableDrivers} runnable`
          : daemon.state === 'running'
            ? 'none authenticated and runnable'
            : 'start the daemon to inspect drivers',
    });
  }

  const ready =
    repositoryReady &&
    worktreeReady &&
    daemon.state === 'running' &&
    runnableDrivers > 0 &&
    checks.every((check) => check.state !== 'missing' && check.state !== 'invalid');
  return { ready, checks, drivers };
}

export async function runDoctor(
  args: string[],
  io: CliIo,
  dependencies: DoctorDependencies = {},
): Promise<number> {
  let options: Options;
  try {
    options = parse(args);
  } catch (error) {
    return emitUsageError(`${(error as Error).message}\nUsage: roflock doctor [--json]`, args, io);
  }
  try {
    const report = await collectDoctorReport(options, dependencies);
    if (options.json) io.stdout(JSON.stringify(report));
    else {
      for (const check of report.checks) io.stdout(renderCheck(check));
      for (const driver of report.drivers) {
        io.stdout(
          `${driver.name.padEnd(20)} ${driver.installed ? 'installed' : 'not installed'} · ${driver.authenticated ? 'authenticated' : 'not authenticated'} · ${driver.runnable ? 'runnable' : 'not runnable'}`,
        );
      }
    }
    return report.ready ? ExitCode.Ok : ExitCode.Config;
  } catch (error) {
    return emitRuntimeError(error, io, options.json, ExitCode.Config);
  }
}

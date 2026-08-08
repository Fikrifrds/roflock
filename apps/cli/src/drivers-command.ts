import { DaemonClient, type DaemonClientOptions } from './daemon-client.js';
import { ExitCode } from './exit-codes.js';
import type { CliIo } from './main.js';
import { emitRuntimeError, emitUsageError } from './runtime-output.js';

interface DriverCapabilities {
  streaming: boolean;
  structuredOutput: boolean;
  workspaceRead: boolean;
  workspaceWrite: boolean;
  sessions: boolean;
  resume: boolean;
  cancellation: string;
  usageReporting: boolean;
  modelSelection: boolean;
  effortSelection: boolean;
  toolEvents: boolean;
  permissionControls: boolean;
}

export interface ProviderInventoryItem {
  id: string;
  displayName: string;
  status: 'ready' | 'missing' | 'unauthenticated' | 'error';
  health: { status: string; binary?: string; version?: string; detail?: string };
  connectionType: 'fake' | 'cli' | 'openai-compatible';
  account?: { loggedIn: boolean; detail?: string };
  driverCapabilities?: DriverCapabilities;
}

export interface DriverStatus {
  id: string;
  name: string;
  installed: boolean;
  detected: boolean;
  authenticated: boolean;
  runnable: boolean;
  binary?: string;
  version?: string;
  detail?: string;
  capabilities?: DriverCapabilities;
}

interface Options {
  fresh: boolean;
  json: boolean;
  daemonUrl?: string;
  dataDir?: string;
}

class UsageError extends Error {}

function parse(args: string[]): Options {
  let fresh = false;
  let json = false;
  let daemonUrl: string | undefined;
  let dataDir: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === 'doctor') fresh = true;
    else if (arg === '--json') json = true;
    else if (arg === '--daemon-url' || arg === '--data-dir') {
      const value = args[index + 1];
      if (!value) throw new UsageError(`${arg} needs a value`);
      index += 1;
      if (arg === '--daemon-url') daemonUrl = value;
      else dataDir = value;
    } else throw new UsageError(`Unknown option '${arg}'`);
  }
  return {
    fresh,
    json,
    ...(daemonUrl === undefined ? {} : { daemonUrl }),
    ...(dataDir === undefined ? {} : { dataDir }),
  };
}

export function projectDriverStatus(provider: ProviderInventoryItem): DriverStatus {
  const detected = true;
  const installed = provider.connectionType !== 'cli' || provider.status !== 'missing';
  const authenticated = provider.account?.loggedIn ?? provider.status === 'ready';
  const runnable = installed && authenticated && provider.status === 'ready';
  return {
    id: provider.id,
    name: provider.displayName,
    installed,
    detected,
    authenticated,
    runnable,
    ...(provider.health.binary === undefined ? {} : { binary: provider.health.binary }),
    ...(provider.health.version === undefined ? {} : { version: provider.health.version }),
    ...(provider.health.detail === undefined ? {} : { detail: provider.health.detail }),
    ...(provider.driverCapabilities === undefined
      ? {}
      : { capabilities: provider.driverCapabilities }),
  };
}

function stateLine(driver: DriverStatus): string {
  const states = [
    driver.installed ? 'installed' : 'not installed',
    driver.detected ? 'detected' : 'not detected',
    driver.authenticated ? 'authenticated' : 'not authenticated',
    driver.runnable ? 'runnable' : 'not runnable',
  ];
  return `${driver.name.padEnd(20)} ${states.join(' · ')}`;
}

export async function runDrivers(
  args: string[],
  io: CliIo,
  dependencies: { clientOptions?: DaemonClientOptions } = {},
): Promise<number> {
  let options: Options;
  try {
    options = parse(args);
  } catch (error) {
    return emitUsageError(
      `${(error as Error).message}\nUsage: roflock drivers [doctor] [--json]`,
      args,
      io,
    );
  }
  const client = new DaemonClient({
    ...dependencies.clientOptions,
    ...(options.daemonUrl === undefined ? {} : { baseUrl: options.daemonUrl }),
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
  });
  try {
    const providers = await client.request<ProviderInventoryItem[]>(
      'GET',
      `/api/providers${options.fresh ? '?fresh=1' : ''}`,
    );
    const drivers = providers.map(projectDriverStatus);
    if (options.json) io.stdout(JSON.stringify({ drivers }));
    else if (drivers.length === 0) io.stdout('No drivers are registered.');
    else {
      for (const driver of drivers) {
        io.stdout(stateLine(driver));
        if (driver.capabilities) {
          io.stdout(
            `  write=${driver.capabilities.workspaceWrite} resume=${driver.capabilities.resume} cancellation=${driver.capabilities.cancellation} permissions=${driver.capabilities.permissionControls}`,
          );
        }
        if (driver.detail) io.stdout(`  ${driver.detail}`);
      }
    }
    return drivers.some((driver) => driver.runnable) ? ExitCode.Ok : ExitCode.Driver;
  } catch (error) {
    return emitRuntimeError(error, io, options.json, ExitCode.Config);
  }
}

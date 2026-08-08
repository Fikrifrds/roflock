import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  DaemonClient,
  readDaemonSession,
  resolveCliDataDir,
  resolveDaemonBaseUrl,
  type DaemonClientOptions,
} from './daemon-client.js';

interface OwnerRecord {
  version: 1;
  pid: number;
  ownerId: string;
  baseUrl: string;
  daemonEntry: string;
  startedAt: string;
}

export interface DaemonLifecycleStatus {
  state: 'running' | 'stopped';
  ownership: 'owned' | 'external' | 'none' | 'unverified';
  baseUrl: string;
  dataDir: string;
  pid?: number;
  ownerId?: string;
}

export interface DaemonLifecycleOptions extends DaemonClientOptions {
  daemonEntry?: string;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  spawnDaemon?: (input: { entry: string; env: NodeJS.ProcessEnv; logFile: string }) => {
    pid?: number;
    unref(): void;
  };
  signal?: (pid: number, signal: NodeJS.Signals) => void;
  isAlive?: (pid: number) => boolean;
}

const OWNER_FILE = 'daemon-owner.json';

function ownerFile(dataDir: string): string {
  return join(dataDir, OWNER_FILE);
}

function readOwner(dataDir: string): OwnerRecord | undefined {
  try {
    const value = JSON.parse(readFileSync(ownerFile(dataDir), 'utf8')) as Partial<OwnerRecord>;
    if (
      value.version === 1 &&
      Number.isInteger(value.pid) &&
      Number(value.pid) > 0 &&
      typeof value.ownerId === 'string' &&
      typeof value.baseUrl === 'string' &&
      typeof value.daemonEntry === 'string' &&
      typeof value.startedAt === 'string'
    ) {
      return value as OwnerRecord;
    }
  } catch {
    // Missing or invalid ownership is never permission to signal a process.
  }
  return undefined;
}

function writeOwner(dataDir: string, owner: OwnerRecord): void {
  mkdirSync(dataDir, { recursive: true });
  const path = ownerFile(dataDir);
  writeFileSync(path, `${JSON.stringify(owner, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function defaultEntry(env: NodeJS.ProcessEnv): string {
  if (env.ROFLOCK_DAEMON_ENTRY) return env.ROFLOCK_DAEMON_ENTRY;
  return fileURLToPath(new URL('../../daemon/dist/index.js', import.meta.url));
}

function defaultSpawn(input: { entry: string; env: NodeJS.ProcessEnv; logFile: string }) {
  const fd = openSync(input.logFile, 'a', 0o600);
  chmodSync(input.logFile, 0o600);
  try {
    return spawn(process.execPath, [input.entry], {
      detached: true,
      stdio: ['ignore', fd, fd],
      env: input.env,
    });
  } finally {
    closeSync(fd);
  }
}

function defaultSignal(pid: number, signal: NodeJS.Signals): void {
  process.kill(pid, signal);
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class DaemonLifecycle {
  readonly baseUrl: string;
  readonly dataDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly spawnDaemon: NonNullable<DaemonLifecycleOptions['spawnDaemon']>;
  private readonly signal: NonNullable<DaemonLifecycleOptions['signal']>;
  private readonly isAlive: NonNullable<DaemonLifecycleOptions['isAlive']>;
  private readonly daemonEntry: string;

  constructor(private readonly options: DaemonLifecycleOptions = {}) {
    this.env = options.env ?? process.env;
    this.baseUrl = resolveDaemonBaseUrl(options);
    this.dataDir = resolveCliDataDir(options);
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.spawnDaemon = options.spawnDaemon ?? defaultSpawn;
    this.signal = options.signal ?? defaultSignal;
    this.isAlive = options.isAlive ?? defaultIsAlive;
    this.daemonEntry = options.daemonEntry ?? defaultEntry(this.env);
  }

  async status(): Promise<DaemonLifecycleStatus> {
    if (!(await this.healthy())) {
      return { state: 'stopped', ownership: 'none', baseUrl: this.baseUrl, dataDir: this.dataDir };
    }
    const owner = readOwner(this.dataDir);
    if (!owner) {
      return {
        state: 'running',
        ownership: 'external',
        baseUrl: this.baseUrl,
        dataDir: this.dataDir,
      };
    }
    try {
      const info = await new DaemonClient(this.options).request<{ ownerId?: string }>(
        'GET',
        '/api/runtime/info',
      );
      const owned =
        info.ownerId === owner.ownerId && owner.baseUrl === this.baseUrl && this.isAlive(owner.pid);
      return {
        state: 'running',
        ownership: owned ? 'owned' : 'unverified',
        baseUrl: this.baseUrl,
        dataDir: this.dataDir,
        pid: owner.pid,
        ownerId: owner.ownerId,
      };
    } catch {
      return {
        state: 'running',
        ownership: 'unverified',
        baseUrl: this.baseUrl,
        dataDir: this.dataDir,
        pid: owner.pid,
      };
    }
  }

  async start(timeoutMs = 10_000): Promise<DaemonLifecycleStatus> {
    const current = await this.status();
    if (current.state === 'running') return current;
    const url = new URL(this.baseUrl);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
    ) {
      throw new Error(`Owned daemon must use a loopback http URL, got ${this.baseUrl}`);
    }
    if (!existsSync(this.daemonEntry)) {
      throw new Error(
        `Roflock daemon entry is missing at ${this.daemonEntry}. Install/build the daemon or set ROFLOCK_DAEMON_ENTRY.`,
      );
    }
    const port = url.port || '80';
    const ownerToken = randomBytes(32).toString('base64url');
    const ownerId = createHash('sha256').update(ownerToken).digest('hex');
    const logDir = join(this.dataDir, 'logs');
    mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, 'daemon.log');
    const child = this.spawnDaemon({
      entry: this.daemonEntry,
      logFile,
      env: {
        ...this.env,
        ROFLOCK_DATA_DIR: this.dataDir,
        ROFLOCK_PORT: port,
        ROFLOCK_OWNER_TOKEN: ownerToken,
        ROFLOCK_QUIET_LAUNCH: '1',
      },
    });
    if (!child.pid) throw new Error('Daemon process started without a PID');
    const record: OwnerRecord = {
      version: 1,
      pid: child.pid,
      ownerId,
      baseUrl: this.baseUrl,
      daemonEntry: this.daemonEntry,
      startedAt: this.now().toISOString(),
    };
    writeOwner(this.dataDir, record);
    child.unref();

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.isAlive(record.pid)) break;
      if (await this.healthy()) {
        try {
          readDaemonSession(this.dataDir);
          const ready = await this.status();
          if (ready.ownership === 'owned') return ready;
        } catch {
          // Session creation and listener readiness are separate startup steps.
        }
      }
      await this.sleep(100);
    }
    if (this.isAlive(record.pid)) this.signal(record.pid, 'SIGTERM');
    throw new Error(`Owned daemon did not become ready; inspect ${logFile}`);
  }

  async stop(timeoutMs = 5_000): Promise<DaemonLifecycleStatus> {
    const owner = readOwner(this.dataDir);
    if (!owner) throw new Error('No CLI-owned daemon record exists; refusing to signal a process');
    const current = await this.status();
    if (current.state === 'stopped') {
      unlinkSync(ownerFile(this.dataDir));
      return current;
    }
    if (current.ownership !== 'owned' || current.ownerId !== owner.ownerId) {
      throw new Error('The active daemon did not prove CLI ownership; refusing to stop it');
    }
    this.signal(owner.pid, 'SIGTERM');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.isAlive(owner.pid) || !(await this.healthy())) {
        unlinkSync(ownerFile(this.dataDir));
        return {
          state: 'stopped',
          ownership: 'none',
          baseUrl: this.baseUrl,
          dataDir: this.dataDir,
        };
      }
      await this.sleep(100);
    }
    throw new Error(
      `Daemon ${owner.pid} did not stop after SIGTERM; ownership record was preserved`,
    );
  }

  private async healthy(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/health`);
      if (!response.ok) return false;
      const body = (await response.json()) as { ok?: boolean; service?: string };
      return body.ok === true && body.service === 'roleflock-daemon';
    } catch {
      return false;
    }
  }
}

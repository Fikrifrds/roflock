import { spawn } from 'node:child_process';
export const OUTCOME_UNKNOWN = 'OUTCOME_UNKNOWN' as const;
export type ProcessOutcome = 'completed' | 'failed' | 'stopped' | typeof OUTCOME_UNKNOWN;
export class RuntimeLease {
  private expiresAt = 0;
  constructor(
    public readonly id: string,
    private readonly ttlMs = 30_000,
  ) {}
  acquire(now = Date.now()) {
    if (this.expiresAt > now) return false;
    this.expiresAt = now + this.ttlMs;
    return true;
  }
  heartbeat(now = Date.now()) {
    if (this.expiresAt <= now) return false;
    this.expiresAt = now + this.ttlMs;
    return true;
  }
  release() {
    this.expiresAt = 0;
  }
  get active() {
    return this.expiresAt > Date.now();
  }
}
export interface SupervisedProcess {
  pid?: number;
  heartbeat(): void;
  requestStop(): Promise<boolean>;
  forceKill(): void;
  done: Promise<ProcessOutcome>;
}
export class ProcessSupervisor {
  spawn(
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv; onStopRequested?: () => Promise<void> | void },
  ): SupervisedProcess {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      detached: process.platform !== 'win32',
      stdio: 'pipe',
    });
    let lastHeartbeat = Date.now(),
      stopAcknowledged = false;
    const done = new Promise<ProcessOutcome>((resolve) => {
      child.on('error', () => resolve('failed'));
      child.on('close', (code, signal) =>
        resolve(
          stopAcknowledged || signal === 'SIGTERM' || signal === 'SIGKILL'
            ? 'stopped'
            : code === 0
              ? 'completed'
              : 'failed',
        ),
      );
    });
    return {
      pid: child.pid,
      heartbeat: () => {
        lastHeartbeat = Date.now();
      },
      requestStop: async () => {
        await options.onStopRequested?.();
        if (Date.now() - lastHeartbeat > 15_000) return false;
        stopAcknowledged = true;
        child.kill('SIGTERM');
        return true;
      },
      forceKill: () => {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      },
      done,
    };
  }
}
export function reconcileProcess(
  observedRunning: boolean,
  recordedOutcome?: ProcessOutcome,
): ProcessOutcome {
  return observedRunning ? OUTCOME_UNKNOWN : (recordedOutcome ?? OUTCOME_UNKNOWN);
}

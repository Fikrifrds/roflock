import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { InvocationEvent } from '@roleflock/contracts';
import {
  classifyProviderFailure,
  providerDriver,
  readEnvBinary,
  type AgentDriver,
  type InvocationRequest,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderModel,
} from '@roleflock/provider-core';

const execFileAsync = promisify(execFile);

/**
 * OpenCode adapter.
 *
 * Two things about this CLI shape the integration, and both were found by
 * running it rather than reading its docs.
 *
 * **It edits files without being asked.** `opencode run` performs `edit` tool
 * calls with no `--auto` flag and no permission prompt. There is no sandbox
 * option, so `--dir` sets a working directory rather than a boundary. Roflock
 * therefore cannot grant OpenCode a read-only turn: a request whose permissions
 * deny workspace write is *refused*, because passing it through would mean
 * promising a restriction nothing enforces.
 *
 * **It has real sessions** — `--session` and `--continue` resume a prior thread,
 * and every event carries a `sessionID`. `InvocationEvent.invocation.started`
 * now carries that identity through the compatibility seam, so the driver can
 * truthfully declare and exercise session resume.
 */

export interface OpenCodeOptions {
  /** Overrides discovery. Defaults to `OPENCODE_PATH`, then `opencode` on PATH. */
  binary?: string;
}

/**
 * Where OpenCode actually is.
 *
 * Its installer puts the binary in `~/.opencode/bin`, which a non-login shell
 * often does not have on PATH — so looking only for `opencode` reports a fully
 * working install as missing. An explicit `OPENCODE_PATH` always wins.
 */
export function resolveOpenCodeBinary(): string {
  const configured = readEnvBinary('OPENCODE_PATH', '');
  if (configured) return configured;
  const installed = join(homedir(), '.opencode', 'bin', 'opencode');
  return existsSync(installed) ? installed : 'opencode';
}

export function openCodeRunArgs(request: InvocationRequest, sessionId?: string): string[] {
  const args = ['run', '--format', 'json'];
  const workspace = request.permissionEnvelope?.worktree ?? request.cwd;
  if (workspace) args.push('--dir', workspace);
  if (request.model && request.model !== 'default') args.push('-m', request.model);
  // OpenCode calls reasoning effort a "variant" and takes provider-specific
  // names, so the level passes through rather than being translated.
  if (request.effort) args.push('--variant', request.effort);
  if (sessionId) args.push('--session', sessionId);
  args.push(request.prompt);
  return args;
}

export class OpenCodeAdapter implements ProviderAdapter {
  readonly id = 'opencode';

  /**
   * `writes: true` is the honest answer even though it is the less convenient
   * one. Declaring `false` would not stop OpenCode writing — it would only stop
   * Roflock knowing that it might.
   */
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    writes: true,
    headless: true,
  };

  constructor(private readonly binary = resolveOpenCodeBinary()) {}

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const { stdout } = await execFileAsync(this.binary, ['--version'], { timeout: 15_000 });
      const version = stdout.trim().split('\n').at(-1)?.trim();
      return {
        status: 'ready',
        binary: this.binary,
        ...(version === undefined ? {} : { version }),
      };
    } catch {
      return {
        status: 'missing',
        detail: 'OpenCode CLI was not found. Install it or set OPENCODE_PATH.',
      };
    }
  }

  async detectCapabilities(): Promise<ProviderCapabilities> {
    return this.capabilities;
  }

  /**
   * `opencode models` lists `provider/model` ids, which is the form `-m` takes.
   * Discovery is live rather than a hard-coded list, because OpenCode's catalogue
   * depends on which providers the user has authenticated.
   */
  async listModels(): Promise<ProviderModel[]> {
    try {
      const { stdout } = await execFileAsync(this.binary, ['models'], { timeout: 30_000 });
      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('/'))
        .map((id) => ({ id, displayName: id, family: id.split('/')[0] ?? id }));
    } catch {
      return [];
    }
  }

  async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
    const health = await this.healthCheck();
    if (health.status !== 'ready') {
      yield {
        type: 'invocation.failed',
        error: { code: 'OPENCODE_MISSING', message: health.detail ?? 'OpenCode unavailable' },
      };
      return;
    }

    // Refused rather than attempted. OpenCode edits without asking and offers no
    // sandbox, so a read-only turn is a promise this integration cannot keep —
    // and a permission that is not enforced is worse than one never offered.
    if (request.permissionEnvelope !== undefined && !request.permissionEnvelope.allowCommands) {
      yield {
        type: 'invocation.failed',
        error: {
          code: 'OPENCODE_CANNOT_RESTRICT',
          message:
            'OpenCode cannot run read-only: it performs edits without prompting and has no sandbox. Route read-only roles to a provider that can enforce it.',
        },
      };
      return;
    }

    const child = spawn(health.binary!, openCodeRunArgs(request, request.sessionId), {
      cwd: request.permissionEnvelope?.worktree ?? request.cwd,
      signal: request.signal,
    });
    if (child.pid) request.onSpawn?.(child.pid);

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk;
    });
    // An aborted spawn emits `error` on the child; with no listener that is an
    // unhandled error event and takes the daemon down with it.
    let aborted = false;
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.name === 'AbortError') aborted = true;
      else stderr += `\n${error.message}`;
    });
    // The prompt travels in argv, so stdin is never written to. Leaving the pipe
    // open makes some CLIs wait on input that never arrives.
    child.stdin?.end();

    let reportedFailure: string | undefined;
    let buffer = '';
    // `invocation.started` is held back until the first event reveals the
    // session id, so a resumable turn can actually say it is resumable. The
    // wait is bounded: if no event ever arrives, it is emitted below.
    let announced = false;

    for await (const chunk of child.stdout) {
      buffer += String(chunk);
      const lines = buffer.split('\n');
      // A JSON event can straddle a chunk boundary, so the tail is kept back
      // until a newline proves it complete.
      buffer = lines.pop() ?? '';
      for (const line of lines.filter((value) => value.trim())) {
        const event = parseEvent(line);
        if (!announced) {
          announced = true;
          const sessionId = typeof event?.sessionID === 'string' ? event.sessionID : undefined;
          yield {
            type: 'invocation.started',
            invocationId: request.invocationId,
            ...(sessionId === undefined ? {} : { sessionId }),
          };
        }
        yield { type: 'heartbeat', at: new Date().toISOString() };
        if (event === undefined) continue;
        for (const mapped of mapEvent(event)) {
          if (mapped.kind === 'failure') reportedFailure = mapped.message;
          else yield mapped.event;
        }
      }
    }

    if (!announced) {
      yield { type: 'invocation.started', invocationId: request.invocationId };
    }

    const code: number = await new Promise((resolve) =>
      child.on('close', (value) => resolve(value ?? 1)),
    );
    if (aborted || request.signal?.aborted) {
      yield { type: 'invocation.interrupted', reason: 'Provider run aborted before completion' };
      return;
    }
    if (code === 0 && reportedFailure === undefined) {
      yield { type: 'invocation.completed', output: '' };
      return;
    }

    const reason = reportedFailure ?? stderr;
    const kind = classifyProviderFailure(reason);
    yield {
      type: 'invocation.failed',
      error: {
        code: `OPENCODE_${kind.toUpperCase()}`,
        message: reason || `exit ${code}`,
        retryable: kind === 'transient' || kind === 'unknown',
      },
    };
  }
}

interface OpenCodeEvent {
  type?: unknown;
  sessionID?: unknown;
  part?: Record<string, unknown>;
  error?: unknown;
  message?: unknown;
}

function parseEvent(line: string): OpenCodeEvent | undefined {
  try {
    return JSON.parse(line) as OpenCodeEvent;
  } catch {
    return undefined;
  }
}

type Mapped = { kind: 'event'; event: InvocationEvent } | { kind: 'failure'; message: string };

/** OpenCode nests everything under `part`, keyed by an outer `type`. */
function mapEvent(event: OpenCodeEvent): Mapped[] {
  const part = event.part ?? {};

  switch (event.type) {
    case 'text': {
      const text = part['text'];
      return typeof text === 'string' && text
        ? [{ kind: 'event', event: { type: 'model.output.delta', text } }]
        : [];
    }
    case 'reasoning': {
      const text = part['text'];
      return typeof text === 'string' && text
        ? [{ kind: 'event', event: { type: 'model.reasoning.delta', text } }]
        : [];
    }
    case 'tool_use': {
      const tool = part['tool'];
      if (typeof tool !== 'string') return [];
      const state = part['state'] as { status?: unknown } | undefined;
      return state?.status === 'completed'
        ? [{ kind: 'event', event: { type: 'tool.completed', tool } }]
        : [{ kind: 'event', event: { type: 'tool.started', tool } }];
    }
    case 'step_finish': {
      const mapped: Mapped[] = [];
      const tokens = part['tokens'] as Record<string, unknown> | undefined;
      const cost = part['cost'];
      if (tokens !== undefined || typeof cost === 'number') {
        mapped.push({
          kind: 'event',
          event: {
            type: 'usage.updated',
            usage: {
              ...(typeof tokens?.['input'] === 'number' ? { inputTokens: tokens['input'] } : {}),
              ...(typeof tokens?.['output'] === 'number' ? { outputTokens: tokens['output'] } : {}),
              ...(typeof cost === 'number' ? { costUsd: cost } : {}),
            },
          },
        });
      }
      return mapped;
    }
    case 'error': {
      // Same lesson as Codex: the reason a turn failed arrives on stdout, and
      // reading stderr instead reports incidental noise as the cause.
      const nested = (event.error as { message?: unknown } | undefined)?.message;
      const message = typeof event.message === 'string' ? event.message : nested;
      return typeof message === 'string' && message.trim()
        ? [{ kind: 'failure', message }]
        : [{ kind: 'failure', message: 'OpenCode reported an error without a message' }];
    }
    default:
      return [];
  }
}

/**
 * OpenCode as an `AgentDriver`.
 *
 * Nothing is claimed that cannot be delivered. `usageReporting` and `toolEvents`
 * are true because the CLI emits both and the adapter maps them.
 * `permissionControls` is false: OpenCode's only choice is between asking a
 * human and doing the work, with no way to confine writes to a path. Session
 * identity and resume are true because both are exercised through `--session`.
 */
export function openCodeDriver(options: OpenCodeOptions = {}): AgentDriver {
  return providerDriver(new OpenCodeAdapter(options.binary), {
    capabilities: {
      // Earned now that the session id reaches the runtime. `resume` follows
      // from `--session`, which the wrapper wires to `resume()`.
      sessions: true,
      resume: true,
      usageReporting: true,
      toolEvents: true,
      permissionControls: false,
    },
  });
}

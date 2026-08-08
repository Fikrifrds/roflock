import { spawn } from 'node:child_process';
import type { InvocationEvent } from '@roleflock/contracts';
import {
  EFFORT_LEVELS,
  classifyProviderFailure,
  parseReportedUsage,
  whichBinary,
  type InvocationRequest,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderModel,
  providerDriver,
  type AgentDriver,
} from '@roleflock/provider-core';

export async function discoverCodex(
  binary = process.env.CODEX_PATH ?? 'codex',
): Promise<Pick<ProviderHealth, 'binary' | 'version' | 'status'>> {
  const resolved = await whichBinary(binary);
  return resolved ? { status: 'ready', binary: resolved } : { status: 'missing' };
}

/**
 * Builds an explicit, non-interactive Codex command.
 *
 * RoleFlock never inherits a permissive sandbox choice from a user's Codex
 * configuration: reasoning roles are read-only and a writer is restricted to
 * the leased worktree.
 */
export function codexExecArgs(request: InvocationRequest): string[] {
  const worktree = request.permissionEnvelope?.worktree;
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--ephemeral',
    '--sandbox',
    worktree ? 'workspace-write' : 'read-only',
  ];
  const workspace = worktree ?? request.cwd;
  if (workspace) args.push('--cd', workspace);
  if (request.model && request.model !== 'default') args.push('-m', request.model);
  if (request.effort) args.push('-c', `model_reasoning_effort="${request.effort}"`);
  args.push(request.prompt);
  return args;
}

/** Sandboxed Codex adapter for both reasoning and leased writer turns. */
export class CodexAdapter implements ProviderAdapter {
  readonly id = 'codex';
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    writes: true,
    headless: true,
  };

  constructor(private readonly binary = process.env.CODEX_PATH ?? 'codex') {}

  async healthCheck(): Promise<ProviderHealth> {
    const discovery = await discoverCodex(this.binary);
    return discovery.status === 'ready'
      ? discovery
      : { ...discovery, detail: 'Codex CLI was not found on PATH.' };
  }

  async detectCapabilities(): Promise<ProviderCapabilities> {
    return this.capabilities;
  }

  /**
   * `codex` has no machine-readable model list, so this mirrors what its
   * interactive picker offers. Unlike Cursor, Codex takes reasoning level as a
   * separate setting, so these ids carry no effort suffix — the same model at a
   * different effort is one entry here, not two.
   *
   * `-m` forwards whatever it is given, so a model missing from this list still
   * works if typed; an account that does not have it fails as `unknown_model`
   * and the router moves to the next candidate.
   */
  async listModels(): Promise<ProviderModel[]> {
    return [
      { id: 'default', displayName: 'Account default', family: 'default' },
      {
        id: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol — frontier agentic coding',
        family: 'gpt-5.6-sol',
      },
      {
        id: 'gpt-5.6-terra',
        displayName: 'GPT-5.6 Terra — balanced everyday work',
        family: 'gpt-5.6-terra',
      },
      {
        id: 'gpt-5.6-luna',
        displayName: 'GPT-5.6 Luna — fast and affordable',
        family: 'gpt-5.6-luna',
      },
      { id: 'gpt-5.5', displayName: 'GPT-5.5 — complex coding and research', family: 'gpt-5.5' },
      { id: 'gpt-5.4', displayName: 'GPT-5.4 — strong everyday coding', family: 'gpt-5.4' },
      {
        id: 'gpt-5.4-mini',
        displayName: 'GPT-5.4 mini — small and cost-efficient',
        family: 'gpt-5.4',
      },
    ].map((model) => ({
      ...model,
      catalogueSource: 'curated_alias' as const,
      supportedEffort: [...EFFORT_LEVELS],
    }));
  }

  async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
    const health = await this.healthCheck();
    if (health.status === 'missing') {
      throw new Error('Codex CLI is not installed or not available on PATH.');
    }
    yield { type: 'invocation.started', invocationId: request.invocationId };
    yield { type: 'heartbeat', at: new Date().toISOString() };

    const args = codexExecArgs(request);
    const cwd = request.permissionEnvelope?.worktree ?? request.cwd;

    const child = spawn(health.binary!, args, {
      cwd,
      signal: request.signal,
    });
    if (child.pid) request.onSpawn?.(child.pid);
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d;
    });
    // Aborting a spawned child makes Node emit `error` on it. With no listener
    // that is an unhandled error event, which takes the whole daemon down —
    // pressing Stop killed the process that was meant to do the stopping.
    let aborted = false;
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.name === 'AbortError') aborted = true;
      else stderr += `\n${error.message}`;
    });

    // `codex exec` reads additional input from stdin. With the pipe left open
    // it waits for input that never comes, and the turn hangs until timeout.
    child.stdin?.end();

    // Why the turn failed, as Codex itself reported it on stdout.
    let reportedFailure: string | undefined;

    for await (const chunk of child.stdout) {
      yield { type: 'heartbeat', at: new Date().toISOString() };
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        try {
          const event = JSON.parse(line) as Record<string, unknown>;

          const usage = parseReportedUsage(event.usage);
          if (usage) yield { type: 'usage.updated', usage: { ...usage } };

          // Codex reports why a turn failed on **stdout**, as a JSON event —
          // stderr carries only incidental notices. Reading the reason from
          // stderr therefore reported "Reading additional input from stdin..."
          // for a run that actually failed on an exhausted quota, and quota is
          // the one failure kind that changes routing: unrecognised, the router
          // keeps retrying a provider that cannot succeed until its window
          // resets.
          if (event.type === 'error' || event.type === 'turn.failed') {
            const nested = (event.error as { message?: unknown } | undefined)?.message;
            const reported = typeof event.message === 'string' ? event.message : nested;
            if (typeof reported === 'string' && reported.trim()) reportedFailure = reported;
            continue;
          }

          // Codex nests the reply under `item`, so the flat field names the
          // other CLIs use find nothing here and the output was being dropped.
          const item = event.item as { text?: unknown } | undefined;
          const text = item?.text ?? event.delta ?? event.message ?? event.text;
          if (typeof text === 'string') yield { type: 'model.output.delta', text };
        } catch {
          yield { type: 'model.output.delta', text: line };
        }
      }
    }

    const code: number = await new Promise((resolve) =>
      child.on('close', (value) => resolve(value ?? 1)),
    );
    if (aborted || request.signal?.aborted) {
      // Why the signal fired is the caller's to know; see provider-claude.
      yield { type: 'invocation.interrupted', reason: 'Provider run aborted before completion' };
      return;
    }
    if (code === 0) {
      yield { type: 'invocation.completed', output: '' };
      return;
    }
    // Codex's own reason first: it is the only source that distinguishes an
    // exhausted quota from a transient error, and stderr is mostly noise.
    const reason = reportedFailure ?? stderr;
    const kind = classifyProviderFailure(reason);
    yield {
      type: 'invocation.failed',
      error: {
        code: `CODEX_${kind.toUpperCase()}`,
        message: reason || `exit ${code}`,
        retryable: kind === 'transient' || kind === 'unknown',
      },
    };
  }
}

/**
 * Codex as an `AgentDriver`.
 *
 * Wraps the working adapter rather than reimplementing it: the CLI process
 * handling, sandbox flags and failure classification here are the parts worth
 * keeping, and the driver contract is a new way to reach them, not a reason to
 * rewrite them.
 *
 * Capabilities beyond the adapter's own are declared explicitly. `toolEvents`
 * is true because Codex reports tool activity; `sessions` and `resume` are not,
 * because this integration starts a fresh `exec` each turn and claiming
 * otherwise would be a promise the runtime would act on.
 */
export function codexDriver(...args: ConstructorParameters<typeof CodexAdapter>): AgentDriver {
  return providerDriver(new CodexAdapter(...args), {
    // `usageReporting` is claimed because the adapter maps Codex's reported
    // usage — but only when Codex sends it. Conformance requires a usage event
    // on the probe turn, so if a Codex release stops reporting, this claim fails
    // loudly rather than the ledger quietly recording nothing.
    capabilities: { toolEvents: true, structuredOutput: false, usageReporting: true },
  });
}

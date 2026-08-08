import type { InvocationEvent } from '@roleflock/contracts';
import {
  availabilityFromHealth,
  capabilitiesFromProvider,
  type AgentDriver,
  type AgentEvent,
  type AgentRunRequest,
  type DriverAvailability,
  type DriverCapabilities,
  type InterruptResult,
} from './driver.js';
import type { ProviderAdapter, ProviderModel } from './index.js';

/**
 * Presents an existing `ProviderAdapter` as an `AgentDriver`.
 *
 * The migration plan is explicit that adapter compatibility is not removed
 * until the equivalent driver passes conformance. This is how both exist at
 * once: the working Codex, Claude and Cursor integrations answer the new
 * contract today, and the runtime can move to drivers before any of them is
 * rewritten.
 *
 * The mapping is deliberately pessimistic. An adapter spawns a local CLI, so
 * cancellation is `local-process` and never better — killing that process says
 * nothing about a request already in flight to a paid API, and claiming
 * otherwise is the one lie the conformance suite exists to catch.
 *
 * Permission enforcement is **delegated**, not performed here. The envelope
 * handed to the adapter is what confines it; this wrapper adds only an early
 * refusal for objectives that plainly need write access. See `start`.
 */

export interface ProviderDriverOptions {
  /**
   * Capabilities the adapter genuinely has beyond what `ProviderCapabilities`
   * can express. Every override is a promise conformance will hold you to.
   *
   * `cancellation` is deliberately not overridable. An adapter spawns a local
   * CLI, so `local-process` is the most it can ever prove, and a caller that
   * could raise it would produce a *self-consistent* lie — `interrupt` would
   * agree with the claim, conformance would find no contradiction, and a user
   * would be told their work stopped while a paid provider carried on. Making
   * it unrepresentable is better than catching it.
   */
  capabilities?: Omit<Partial<DriverCapabilities>, 'cancellation'>;
  /** Reports the pid of a spawned process, for post-crash reconciliation. */
  onSpawn?: (pid: number) => void;
}

export class ProviderBackedDriver implements AgentDriver {
  readonly id: string;
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly adapter: ProviderAdapter,
    private readonly options: ProviderDriverOptions = {},
  ) {
    this.id = adapter.id;
  }

  async detect(): Promise<DriverAvailability> {
    if (this.adapter.healthCheck === undefined) {
      // No health check means nothing has been verified. Reporting "ready"
      // would send a run to a CLI that may not be installed or logged in.
      return { detected: false, authenticated: false, detail: 'adapter reports no health' };
    }
    return availabilityFromHealth(await this.adapter.healthCheck());
  }

  async capabilities(): Promise<DriverCapabilities> {
    const detected = this.adapter.detectCapabilities
      ? await this.adapter.detectCapabilities()
      : this.adapter.capabilities;
    return capabilitiesFromProvider(detected, {
      ...(this.options.capabilities ?? {}),
      // Restated rather than merely omitted from the type, so a cast cannot
      // route around it either.
      cancellation: 'local-process',
    });
  }

  async models(): Promise<ProviderModel[]> {
    return this.adapter.listModels ? this.adapter.listModels() : [];
  }

  async *start(request: AgentRunRequest): AsyncIterable<AgentEvent> {
    const controller = new AbortController();
    this.running.set(request.invocationKey, controller);

    if (request.signal) {
      if (request.signal.aborted) controller.abort();
      else request.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    // An early refusal for objectives that plainly need write access, so a
    // clearly-misrouted turn costs nothing.
    //
    // This is a *guard, not the enforcement*. It matches words, and an
    // objective like "refactor billing" sails past it. What actually confines
    // the adapter is the permission envelope below — empty `allowedPaths`,
    // `allowCommands: false` — enforced by the CLI's own sandbox. Treating this
    // regex as the boundary would be exactly the mistake of putting a security
    // control in text matching.
    if (
      !request.permissions.workspaceWrite &&
      /\b(write|edit|modify|patch)\b/i.test(request.objective)
    ) {
      yield {
        type: 'settled',
        outcome: 'refused',
        detail: 'objective requires workspace write, which this run was not granted',
      };
      this.running.delete(request.invocationKey);
      return;
    }

    let started = false;
    let settled = false;
    try {
      for await (const event of this.adapter.invoke({
        invocationId: request.invocationKey,
        prompt: request.objective,
        cwd: request.workspacePath,
        signal: controller.signal,
        permissionEnvelope: {
          worktree: request.workspacePath,
          allowedPaths: request.permissions.workspaceWrite ? [request.workspacePath] : [],
          allowCommands: request.permissions.workspaceWrite,
        },
        ...(request.model === undefined ? {} : { model: request.model }),
        ...(request.effort === undefined ? {} : { effort: request.effort }),
        ...(this.options.onSpawn === undefined ? {} : { onSpawn: this.options.onSpawn }),
      })) {
        const mapped = toAgentEvent(event);
        if (mapped === undefined) continue;
        if (mapped.type === 'started') {
          if (started) continue;
          started = true;
        } else if (!started) {
          // Conformance requires `started` first, and an adapter that emits
          // output before announcing itself would otherwise fail for a reason
          // that is this wrapper's fault rather than the adapter's.
          started = true;
          yield { type: 'started' };
        }
        if (mapped.type === 'settled') {
          if (settled) continue;
          settled = true;
        }
        yield mapped;
      }
    } finally {
      this.running.delete(request.invocationKey);
    }

    if (!started) yield { type: 'started' };
    // An adapter that ended without saying how is not a success. Saying so is
    // the difference between an unknown outcome and a fabricated one.
    if (!settled) {
      yield { type: 'settled', outcome: 'failed', detail: 'adapter ended without an outcome' };
    }
  }

  async interrupt(invocationKey: string): Promise<InterruptResult> {
    const controller = this.running.get(invocationKey);
    controller?.abort();
    const capability = (await this.capabilities()).cancellation;
    return {
      // Never true for a CLI adapter. The local process is gone; whether the
      // provider stopped working — and billing — is not something we observed.
      stopped: capability === 'remote-confirmed',
      capability,
      ...(controller === undefined
        ? { detail: 'no run was in flight under that key' }
        : { detail: 'local process signalled; remote work not confirmed stopped' }),
    };
  }
}

function toAgentEvent(event: InvocationEvent): AgentEvent | undefined {
  switch (event.type) {
    case 'invocation.started':
      return { type: 'started' };
    case 'model.output.delta':
      return { type: 'output', text: event.text };
    case 'model.reasoning.delta':
      return { type: 'reasoning', text: event.text };
    case 'tool.started':
      return { type: 'tool', name: event.tool };
    case 'tool.completed':
      return { type: 'tool', name: event.tool, detail: 'completed' };
    case 'usage.updated': {
      const usage = event.usage as Record<string, unknown>;
      const number = (key: string) =>
        typeof usage[key] === 'number' ? (usage[key] as number) : undefined;
      return {
        type: 'usage',
        ...(number('inputTokens') === undefined ? {} : { inputTokens: number('inputTokens') }),
        ...(number('outputTokens') === undefined ? {} : { outputTokens: number('outputTokens') }),
        ...(number('costUsd') === undefined ? {} : { costUsd: number('costUsd') }),
      };
    }
    case 'invocation.completed':
      return { type: 'settled', outcome: 'completed' };
    case 'invocation.failed':
      return { type: 'settled', outcome: 'failed', detail: event.error.message };
    case 'invocation.interrupted':
      return { type: 'settled', outcome: 'failed', detail: event.reason };
    default:
      // Heartbeats, phase changes and confirmation requests carry no meaning in
      // the driver contract. Dropping them is deliberate; inventing an
      // equivalent would put runtime concepts into a provider seam.
      return undefined;
  }
}

export function providerDriver(
  adapter: ProviderAdapter,
  options?: ProviderDriverOptions,
): AgentDriver {
  return new ProviderBackedDriver(adapter, options);
}

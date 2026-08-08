import type {
  AgentDriver,
  AgentEvent,
  AgentRunRequest,
  DriverAvailability,
  DriverCapabilities,
  InterruptResult,
} from '@roleflock/provider-core';

/**
 * A deterministic driver for testing graph and runtime semantics.
 *
 * Its whole purpose is to remove provider uncertainty: a test about retry
 * routing or writer serialisation should fail because the runtime is wrong, not
 * because a CLI was slow. Nothing here talks to a network, spawns a process, or
 * touches a repository.
 *
 * It is also the reference implementation of the conformance suite, so a real
 * driver has something correct to be compared against.
 */

export interface FakeDriverScript {
  /** Outcome per invocation key, in call order, defaulting to completion. */
  outcomes?: Record<string, Array<'completed' | 'failed' | 'refused'>>;
  /** Text emitted before settling. */
  output?: string;
  /** Overrides for what this driver claims it can do. */
  capabilities?: Partial<DriverCapabilities>;
  availability?: Partial<DriverAvailability>;
  /** Blocks until released, so a test can observe a run in flight. */
  hold?: () => Promise<void>;
}

export const FAKE_DRIVER_CAPABILITIES: DriverCapabilities = {
  streaming: true,
  structuredOutput: true,
  workspaceRead: true,
  workspaceWrite: true,
  sessions: true,
  resume: true,
  // The fake driver runs in this process, so it genuinely can prove that work
  // stopped. A real CLI driver almost never can.
  cancellation: 'remote-confirmed',
  usageReporting: true,
  modelSelection: true,
  effortSelection: true,
  toolEvents: true,
  permissionControls: true,
};

export class FakeDriver implements AgentDriver {
  readonly id = 'fake';
  private readonly calls = new Map<string, number>();
  private readonly interrupted = new Set<string>();
  readonly requests: AgentRunRequest[] = [];

  constructor(private readonly script: FakeDriverScript = {}) {}

  async detect(): Promise<DriverAvailability> {
    return { detected: true, authenticated: true, version: '1.0.0', ...this.script.availability };
  }

  async capabilities(): Promise<DriverCapabilities> {
    return { ...FAKE_DRIVER_CAPABILITIES, ...this.script.capabilities };
  }

  /** How many times a turn was started. A resumed turn must not increase it. */
  timesStarted(invocationKey: string): number {
    return this.calls.get(invocationKey) ?? 0;
  }

  async *start(request: AgentRunRequest): AsyncIterable<AgentEvent> {
    this.requests.push(request);
    const attempt = (this.calls.get(request.invocationKey) ?? 0) + 1;
    this.calls.set(request.invocationKey, attempt);

    if (request.permissions.workspaceWrite === false && request.objective.includes('write')) {
      // A driver must never exceed the permissions it was given, and refusing
      // loudly is better than doing the work and reporting success.
      yield { type: 'settled', outcome: 'refused', detail: 'workspace write not permitted' };
      return;
    }

    yield { type: 'started', sessionId: `session_${request.invocationKey}`, pid: 4242 };
    if (this.script.hold) await this.script.hold();
    if (request.signal?.aborted || this.interrupted.has(request.invocationKey)) {
      yield { type: 'settled', outcome: 'failed', detail: 'cancelled' };
      return;
    }
    yield { type: 'output', text: this.script.output ?? `ran ${request.objective}` };
    yield { type: 'usage', inputTokens: 10, outputTokens: 20 };

    const outcome = this.script.outcomes?.[request.invocationKey]?.[attempt - 1] ?? 'completed';
    yield { type: 'settled', outcome };
  }

  async *resume(sessionId: string, request: AgentRunRequest): AsyncIterable<AgentEvent> {
    yield { type: 'started', sessionId };
    yield { type: 'output', text: `resumed ${request.objective}` };
    yield { type: 'settled', outcome: 'completed' };
  }

  async interrupt(invocationKey: string): Promise<InterruptResult> {
    this.interrupted.add(invocationKey);
    const capability = (await this.capabilities()).cancellation;
    return {
      // Only a driver that can observe the work stop may say it stopped.
      stopped: capability === 'remote-confirmed',
      capability,
    };
  }
}

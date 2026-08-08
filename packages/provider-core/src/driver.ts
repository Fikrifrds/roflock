import type { Effort, ProviderCapabilities, ProviderHealth, ProviderModel } from './index.js';

/**
 * AgentDriver v1 — the contract every coding harness integration answers to.
 *
 * Roflock does not replace a coding agent. The harness keeps its own agent
 * loop, file editing, tools and provider authentication; the driver is the seam
 * through which Roflock starts one, watches it, and — where the harness allows
 * — stops it. Codex, Claude Code, Pi and OpenCode are drivers, not graph
 * semantics: nothing here may leak into Graph IR.
 *
 * The governing rule is truthfulness. A capability declared here is a promise
 * the runtime will rely on, and the most expensive lie available is claiming a
 * run was cancelled when the remote side may still be working and billing.
 */

/**
 * What a driver can actually do.
 *
 * Every field is a claim the runtime acts on, so the honest default for
 * anything a driver cannot demonstrate is `false` — never "probably".
 */
export interface DriverCapabilities {
  streaming: boolean;
  structuredOutput: boolean;

  workspaceRead: boolean;
  workspaceWrite: boolean;

  /** Whether a run can be referred to again after it returns. */
  sessions: boolean;
  resume: boolean;

  cancellation: CancellationCapability;

  usageReporting: boolean;
  modelSelection: boolean;
  effortSelection: boolean;

  toolEvents: boolean;
  permissionControls: boolean;
}

/**
 * How much a driver can promise about stopping work.
 *
 * The distinction is not pedantic. `local-process` means a process on this
 * machine was killed, which says nothing about a request already in flight to a
 * paid API. Only `remote-confirmed` permits Roflock to tell a user their work
 * has stopped; anything weaker leaves the outcome unknown, and ADR-010 governs
 * what happens next.
 */
export type CancellationCapability =
  /** No way to stop it. It runs to completion whatever the user asks. */
  | 'none'
  /** A local process can be killed. Remote work may continue and may bill. */
  | 'local-process'
  /** The harness accepts a stop request but does not confirm it took effect. */
  | 'cooperative'
  /** The far side confirmed the work stopped. Only this may be reported as stopped. */
  | 'remote-confirmed';

/** Whether a stop request may be reported to the user as having stopped work. */
export function stopIsConfirmable(capability: CancellationCapability): boolean {
  return capability === 'remote-confirmed';
}

export interface DriverAvailability {
  /** The executable or endpoint was found. Says nothing about being usable. */
  detected: boolean;
  /**
   * Credentials were verified. Deliberately separate from `detected`: an
   * installed CLI that nobody has logged into is a common state, and reporting
   * it as ready sends a run to a provider that will refuse it.
   */
  authenticated: boolean;
  binary?: string;
  version?: string;
  detail?: string;
}

export interface AgentRunRequest {
  /** Stable identity of the turn; see `stableInvocationKey`. */
  invocationKey: string;
  objective: string;
  workspacePath: string;
  model?: string;
  effort?: Effort;
  /** What the driver may do. A driver must not exceed this, ever. */
  permissions: {
    workspaceWrite: boolean;
    network: boolean;
    allowedCommands?: readonly string[];
  };
  /** Resume an earlier session when the driver supports it. */
  sessionId?: string;
  signal?: AbortSignal;
}

export type AgentEvent =
  | { type: 'started'; sessionId?: string; pid?: number }
  | { type: 'output'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; name: string; detail?: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: 'settled'; outcome: 'completed' | 'failed' | 'refused'; detail?: string };

export interface InterruptResult {
  /** Whether the driver *observed* the work stop, not whether it asked. */
  stopped: boolean;
  capability: CancellationCapability;
  detail?: string;
}

export interface AgentDriver {
  readonly id: string;

  detect(): Promise<DriverAvailability>;
  capabilities(): Promise<DriverCapabilities>;
  models?(): Promise<ProviderModel[]>;

  start(request: AgentRunRequest): AsyncIterable<AgentEvent>;
  resume?(sessionId: string, request: AgentRunRequest): AsyncIterable<AgentEvent>;
  interrupt?(invocationKey: string): Promise<InterruptResult>;
  dispose?(sessionId: string): Promise<void>;
}

/**
 * Bridges the existing provider contract into driver capabilities.
 *
 * `ProviderAdapter` stays working while drivers are built alongside it — the
 * migration plan is explicit that compatibility is not removed until the
 * equivalent driver passes conformance. Everything a provider does not report
 * maps to `false`, because an unproven capability is a capability Roflock must
 * not act on.
 */
export function capabilitiesFromProvider(
  provider: ProviderCapabilities,
  overrides: Partial<DriverCapabilities> = {},
): DriverCapabilities {
  return {
    streaming: provider.streaming,
    structuredOutput: provider.structuredOutput ?? false,
    workspaceRead: true,
    workspaceWrite: provider.writes,
    sessions: false,
    resume: false,
    // A provider adapter spawns a local CLI. Killing it stops that process and
    // proves nothing about a request already in flight to a paid API.
    cancellation: 'local-process',
    usageReporting: false,
    modelSelection: true,
    effortSelection: true,
    toolEvents: provider.tools,
    permissionControls: provider.writes,
    ...overrides,
  };
}

/** Availability from a provider health report, keeping detection and auth apart. */
export function availabilityFromHealth(health: ProviderHealth): DriverAvailability {
  return {
    detected: health.status !== 'missing',
    authenticated: health.status === 'ready',
    ...(health.binary === undefined ? {} : { binary: health.binary }),
    ...(health.version === undefined ? {} : { version: health.version }),
    ...(health.detail === undefined ? {} : { detail: health.detail }),
  };
}

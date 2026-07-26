import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { InvocationEvent } from '@roleflock/contracts';

const execFileAsync = promisify(execFile);

export interface ProviderCapabilities { streaming: boolean; tools: boolean; writes: boolean; headless: boolean; }
export interface ProviderHealth {
  status: 'ready' | 'missing' | 'unauthenticated' | 'error';
  detail?: string;
  binary?: string;
  version?: string;
}

/**
 * How hard the model should think. Providers express this differently — Claude
 * Code takes an `--effort` flag, Codex a config override, and Cursor bakes it
 * into the model id (`claude-opus-5-high` vs `claude-opus-5-low`) — so the
 * contract carries it separately and each adapter decides how to spend it.
 */
export type Effort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export const EFFORT_LEVELS: readonly Effort[] = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
];

/**
 * Not every provider accepts every level — Codex documents up to `ultra`, the
 * Claude CLI stops at `max`. Adapters clamp rather than forward a level the CLI
 * would reject, so asking for more thinking than a provider offers costs the
 * user the extra depth, not the run.
 */
export function clampEffort(effort: Effort, highest: Effort): Effort {
  const wanted = EFFORT_LEVELS.indexOf(effort);
  const ceiling = EFFORT_LEVELS.indexOf(highest);
  return wanted > ceiling ? highest : effort;
}

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORT_LEVELS as readonly string[]).includes(value);
}

export interface ProviderModel {
  id: string;
  displayName: string;
  /** Set when the catalogue encodes effort in the id, so the UI can show it. */
  effort?: Effort;
  /** Family label (`Opus 5`, `GPT-5.6 Sol`) used for grouping in the picker. */
  family?: string;
}

export interface InvocationRequest {
  invocationId: string;
  prompt: string;
  cwd?: string;
  signal?: AbortSignal;
  permissionEnvelope?: PermissionEnvelope;
  /** Provider-specific model id. Omitted means the CLI's own default. */
  model?: string;
  effort?: Effort;
}

export interface PermissionEnvelope { worktree: string; allowedPaths: string[]; allowCommands?: boolean; }

export interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  invoke(request: InvocationRequest): AsyncIterable<InvocationEvent>;
  healthCheck?(): Promise<ProviderHealth>;
  detectCapabilities?(): Promise<ProviderCapabilities>;
  listModels?(): Promise<ProviderModel[]>;
}

/**
 * Why a provider invocation failed, insofar as the CLI told us.
 *
 * `quota_exhausted` is the one that changes behaviour rather than just wording:
 * the router puts that provider+model pair on cooldown and moves to the next
 * candidate, instead of retrying something that cannot succeed until a quota
 * window resets.
 */
export type ProviderFailureKind =
  | 'quota_exhausted'
  | 'unauthenticated'
  | 'unknown_model'
  | 'transient'
  | 'unknown';

const QUOTA_PATTERNS = [
  /\brate[ _-]?limit/i,
  /\bquota\b/i,
  /\busage limit/i,
  /too many requests/i,
  /\b429\b/,
  /insufficient[_ ]quota/i,
  /out of credits?/i,
  /credit balance is too low/i,
  /billing[ _-]?hard[ _-]?limit/i,
  /upgrade (your )?plan/i,
  /limit (will )?reset/i,
];

const UNKNOWN_MODEL_PATTERNS = [
  /unknown model/i,
  /model not found/i,
  /invalid model/i,
  /does not exist or you do not have access/i,
  /unsupported model/i,
  /no such model/i,
  // Cursor Agent's wording, and it exits 0 while saying it.
  /cannot use this model/i,
];

/**
 * A CLI that refused the request while still exiting 0.
 *
 * Cursor Agent does exactly this for an unusable model: the refusal goes to
 * stderr and the process succeeds. Trusting the exit code alone would turn a
 * typo in a model id into a run that produced nothing and reported success —
 * the worst failure mode available, because the graph would carry on.
 */
export function refusalInOutput(stderr: string | undefined): ProviderFailureKind | undefined {
  const text = stderr ?? '';
  if (!text.trim()) return undefined;
  if (UNKNOWN_MODEL_PATTERNS.some((pattern) => pattern.test(text))) return 'unknown_model';
  if (QUOTA_PATTERNS.some((pattern) => pattern.test(text))) return 'quota_exhausted';
  if (UNAUTHENTICATED_PATTERNS.some((pattern) => pattern.test(text))) return 'unauthenticated';
  return undefined;
}

const UNAUTHENTICATED_PATTERNS = [
  /\bunauthori[sz]ed\b/i,
  /\b401\b/,
  /\b403\b/,
  /not logged in/i,
  /please (run )?login/i,
  /invalid api[ _-]?key/i,
  /authentication failed/i,
];

const TRANSIENT_PATTERNS = [
  /\b5\d\d\b/,
  /timed? ?out/i,
  /\bECONN(RESET|REFUSED|ABORTED)\b/,
  /\bENOTFOUND\b/,
  /socket hang up/i,
  /temporarily unavailable/i,
  /overloaded/i,
];

/**
 * Classifies a CLI's stderr or an HTTP error body.
 *
 * Matching vendor prose is inherently approximate, so the order is deliberate.
 * A quota message often carries a 403 and an unknown-model message often
 * mentions access; checking quota first means an exhausted plan is never
 * mistaken for a credentials problem the user cannot fix by logging in again.
 */
export function classifyProviderFailure(message: string | undefined): ProviderFailureKind {
  const text = message ?? '';
  if (!text.trim()) return 'unknown';
  if (QUOTA_PATTERNS.some((pattern) => pattern.test(text))) return 'quota_exhausted';
  if (UNKNOWN_MODEL_PATTERNS.some((pattern) => pattern.test(text))) return 'unknown_model';
  if (UNAUTHENTICATED_PATTERNS.some((pattern) => pattern.test(text))) return 'unauthenticated';
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(text))) return 'transient';
  return 'unknown';
}

/** Resolves a command from PATH without assuming a bare command name exists. */
export async function whichBinary(name: string): Promise<string | undefined> {
  const command = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(command, [name]);
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();
  register(adapter: ProviderAdapter) { if (this.adapters.has(adapter.id)) throw new Error(`Provider already registered: ${adapter.id}`); this.adapters.set(adapter.id, adapter); }
  get(id: string) { const adapter = this.adapters.get(id); if (!adapter) throw new Error(`Provider not found: ${id}`); return adapter; }
  list() { return [...this.adapters.values()]; }
}

export class FakeProvider implements ProviderAdapter {
  readonly capabilities: ProviderCapabilities = { streaming: true, tools: true, writes: false, headless: true };
  constructor(public readonly id = 'fake', private readonly events: InvocationEvent[] = []) {}
  async healthCheck(): Promise<ProviderHealth> { return { status: 'ready' }; }
  async detectCapabilities(): Promise<ProviderCapabilities> { return this.capabilities; }
  async listModels(): Promise<ProviderModel[]> { return [{ id: 'phase0-fake', displayName: 'Phase 0 Fake' }]; }
  async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
    yield { type: 'invocation.started', invocationId: request.invocationId };
    for (const event of this.events) { if (request.signal?.aborted) { yield { type: 'invocation.interrupted', reason: 'aborted' }; return; } yield event; }
    if (!this.events.some((e) => e.type === 'invocation.completed' || e.type === 'invocation.failed')) yield { type: 'invocation.completed', output: '' };
  }
}

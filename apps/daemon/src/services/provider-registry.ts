import {
  FakeProvider,
  ProviderRegistry as AdapterRegistry,
  normalizeProviderModel,
  providerDriver,
  type AgentDriver,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderModel,
} from '@roleflock/provider-core';
import { ClaudeAdapter } from '@roleflock/provider-claude';
import { CodexAdapter } from '@roleflock/provider-codex';
import { CursorWriterAdapter, createFsCursorWriter } from '@roleflock/provider-cursor';
import { OpenAiCompatibleAdapter } from '@roleflock/provider-custom';
import { OpenCodeAdapter, openCodeDriver } from '@roleflock/provider-opencode';
import {
  getProviderAccount,
  runProviderAuthAction,
  type AuthActionResult,
  type ProviderAccount,
} from './cli-account.js';
import { readEnv } from '@roleflock/contracts';

export interface RegisteredProvider {
  id: string;
  displayName: string;
  status: ProviderHealth['status'];
  health: ProviderHealth;
  capabilities: ProviderCapabilities;
  connectionType: 'fake' | 'cli' | 'openai-compatible';
  account?: ProviderAccount;
  localUsage?: {
    entryCount: number;
    inputTokens: number;
    outputTokens: number;
    models: Array<{
      providerConnectionId: string;
      modelId: string;
      inputTokens: number;
      outputTokens: number;
      entryCount: number;
    }>;
    note: string;
  };
}

export interface CustomProviderInput {
  id?: string;
  displayName: string;
  endpoint: string;
  apiKey: string;
  model: string;
}

export function customProviderId(input: Pick<CustomProviderInput, 'id' | 'displayName'>): string {
  return (
    input.id?.trim() ||
    `custom_${input.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`.replace(/^_|_$/g, '')
  );
}

const providerNames: Record<string, string> = {
  fake: 'Deterministic stand-in (test mode)',
  claude: 'Claude CLI',
  codex: 'Codex CLI',
  cursor: 'Cursor Agent CLI',
  opencode: 'OpenCode CLI',
};

const connectionTypes: Record<string, RegisteredProvider['connectionType']> = {
  fake: 'fake',
  claude: 'cli',
  codex: 'cli',
  cursor: 'cli',
  opencode: 'cli',
};

/**
 * The deterministic stand-in exists for tests and for an offline first run. It
 * is not a provider in the ordinary sense — its output is fabricated — so it is
 * only registered when explicitly asked for. Leaving it registered made it
 * pickable on the Roles page, where choosing it would quietly turn a real run
 * into a scripted one.
 */
function fakeProviderEnabled(): boolean {
  return readEnv('FORCE_FAKE') === '1' || readEnv('INCLUDE_FAKE') === '1';
}

function mergeAccountIntoHealth(
  base: ProviderHealth,
  account: ProviderAccount | undefined,
): ProviderHealth {
  if (!account || base.status === 'missing' || base.status === 'error') return base;
  if (!account.loggedIn && account.supportsLogin) {
    return {
      ...base,
      status: 'unauthenticated',
      detail: account.detail ?? 'Sign in required',
    };
  }
  if (account.loggedIn && (account.label || account.detail)) {
    return {
      ...base,
      detail: account.detail ?? base.detail,
    };
  }
  return base;
}

/**
 * Probing a CLI-backed provider spawns `--help` / `--version` subprocesses that
 * can take seconds. The Providers page polls, and one `list()` touches health,
 * capabilities, and account for every adapter, so uncached probing meant dozens
 * of subprocesses per refresh.
 */
const DISCOVERY_CACHE_TTL_MS = 15_000;

/**
 * The daemon's provider inventory. CLI-backed providers are listed even when
 * missing so callers can show their real installation state. Fake stays
 * registered for offline fallback but is hidden from the Providers UI unless
 * ROFLOCK_INCLUDE_FAKE=1.
 */
export class ProviderRegistry {
  private readonly adapters = new AdapterRegistry();
  private readonly drivers = new Map<string, AgentDriver>();
  private readonly customNames = new Map<string, string>();
  private readonly discovery = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor() {
    if (fakeProviderEnabled()) this.registerProvider(new FakeProvider());
    const claude = new ClaudeAdapter();
    const codex = new CodexAdapter();
    this.registerProvider(
      claude,
      providerDriver(claude, { capabilities: { usageReporting: true } }),
    );
    this.registerProvider(
      codex,
      providerDriver(codex, {
        capabilities: { toolEvents: true, structuredOutput: false, usageReporting: true },
      }),
    );
    this.registerProvider(new CursorWriterAdapter(createFsCursorWriter()));
    const opencode = new OpenCodeAdapter();
    this.registerProvider(opencode, openCodeDriver());

    void Promise.all(this.adapters.list().map((adapter) => this.healthCheck(adapter.id))).catch(
      () => undefined,
    );
  }

  /**
   * Memoises a probe by key. The in-flight promise is cached, not just the
   * result, so concurrent callers share a single subprocess instead of racing.
   */
  private probe<T>(key: string, fresh: boolean, factory: () => Promise<T>): Promise<T> {
    const hit = this.discovery.get(key);
    if (!fresh && hit && Date.now() - hit.at < DISCOVERY_CACHE_TTL_MS) {
      return hit.value as Promise<T>;
    }
    const value = factory().catch((error: unknown) => {
      this.discovery.delete(key);
      throw error;
    });
    this.discovery.set(key, { at: Date.now(), value });
    return value;
  }

  /** Drop cached probes for a provider — used after a login/logout changes state. */
  invalidate(id: string): void {
    for (const key of [...this.discovery.keys()]) {
      if (key.endsWith(`:${id}`)) this.discovery.delete(key);
    }
  }

  get(id: string): ProviderAdapter {
    return this.adapters.get(id);
  }

  /** The production invocation seam. Adapters remain only for compatibility metadata. */
  getDriver(id: string): AgentDriver {
    const driver = this.drivers.get(id);
    if (!driver) throw new Error(`Driver not registered: ${id}`);
    return driver;
  }

  /** Register an adapter and its production driver as one routable connection. */
  registerProvider(adapter: ProviderAdapter, driver: AgentDriver = providerDriver(adapter)): void {
    this.adapters.register(adapter);
    this.drivers.set(adapter.id, driver);
  }

  has(id: string): boolean {
    try {
      this.adapters.get(id);
      return true;
    } catch {
      return false;
    }
  }

  registerCustom(input: CustomProviderInput): RegisteredProvider {
    const id = customProviderId(input);
    if (this.has(id)) {
      throw new Error(`Provider already registered: ${id}`);
    }
    if (!input.endpoint.trim() || !input.model.trim()) {
      throw new Error('endpoint and model are required');
    }
    this.registerProvider(
      new OpenAiCompatibleAdapter(id, input.endpoint.trim(), input.apiKey, input.model.trim()),
    );
    this.customNames.set(id, input.displayName.trim() || id);
    connectionTypes[id] = 'openai-compatible';
    return {
      id,
      displayName: this.customNames.get(id)!,
      status: 'ready',
      health: { status: 'ready', detail: 'Custom OpenAI-compatible endpoint registered' },
      capabilities: this.adapters.get(id).capabilities,
      connectionType: 'openai-compatible',
    };
  }

  /**
   * Everything registered. There is no hidden set: a provider that can be
   * routed to must be visible, or the Providers page would disagree with what
   * actually runs. The stand-in is kept out by not registering it at all.
   */
  async list(options: { fresh?: boolean } = {}): Promise<RegisteredProvider[]> {
    const fresh = options.fresh ?? false;
    const adapters = this.adapters.list();
    return Promise.all(
      adapters.map(async (adapter) => {
        const [health, capabilities, account] = await Promise.all([
          this.healthCheck(adapter.id, { fresh }),
          this.capabilities(adapter.id, { fresh }),
          this.account(adapter.id, { fresh }),
        ]);
        return {
          id: adapter.id,
          displayName: this.displayName(adapter.id),
          status: health.status,
          health,
          capabilities,
          connectionType: connectionTypes[adapter.id] ?? 'cli',
          account,
        };
      }),
    );
  }

  /** Sync label for UI projections that must not wait on health/model probes. */
  displayName(id: string): string {
    return this.customNames.get(id) ?? providerNames[id] ?? id;
  }

  async account(
    id: string,
    options: { fresh?: boolean } = {},
  ): Promise<ProviderAccount | undefined> {
    if (id === 'fake') return undefined;
    return this.probe(`account:${id}`, options.fresh ?? false, () =>
      getProviderAccount(id, { fresh: options.fresh }).catch(() => undefined),
    );
  }

  async healthCheck(id: string, options: { fresh?: boolean } = {}): Promise<ProviderHealth> {
    return this.probe(`health:${id}`, options.fresh ?? false, async () => {
      const adapter = this.get(id);
      const base = (await adapter.healthCheck?.()) ?? { status: 'ready' as const };
      if (id === 'fake' || base.status === 'missing' || base.status === 'error') {
        return base;
      }
      if (connectionTypes[id] === 'cli') {
        return mergeAccountIntoHealth(base, await this.account(id, options));
      }
      return base;
    });
  }

  async capabilities(id: string, options: { fresh?: boolean } = {}): Promise<ProviderCapabilities> {
    return this.probe(`caps:${id}`, options.fresh ?? false, async () => {
      const adapter = this.get(id);
      return adapter.detectCapabilities?.() ?? adapter.capabilities;
    });
  }

  async models(id: string): Promise<ProviderModel[]> {
    const adapter = this.get(id);
    const [models, capabilities] = await Promise.all([
      adapter.listModels?.() ?? Promise.resolve([]),
      this.capabilities(id),
    ]);
    return models.map((model) => normalizeProviderModel(id, capabilities, model));
  }

  async authAction(id: string, action: 'login' | 'logout' | 'switch'): Promise<AuthActionResult> {
    if (!this.has(id)) throw new Error(`Provider not found: ${id}`);
    const result = await runProviderAuthAction(id, action);
    this.invalidate(id);
    return result;
  }
}

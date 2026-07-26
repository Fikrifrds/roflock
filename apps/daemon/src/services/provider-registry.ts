import {
  FakeProvider,
  ProviderRegistry as AdapterRegistry,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderModel,
} from '@roleflock/provider-core';
import { ClaudeAdapter } from '@roleflock/provider-claude';
import { CodexAdapter } from '@roleflock/provider-codex';
import { CursorWriterAdapter, createFsCursorWriter } from '@roleflock/provider-cursor';
import { OpenAiCompatibleAdapter } from '@roleflock/provider-custom';
import {
  getProviderAccount,
  runProviderAuthAction,
  type AuthActionResult,
  type ProviderAccount,
} from './cli-account.js';

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
    actualCostUsd: number;
    shadowCostUsd: number;
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

const providerNames: Record<string, string> = {
  fake: 'Phase 0 Fake Provider',
  claude: 'Claude CLI',
  codex: 'Codex CLI',
  cursor: 'Cursor Agent CLI',
};

const connectionTypes: Record<string, RegisteredProvider['connectionType']> = {
  fake: 'fake',
  claude: 'cli',
  codex: 'cli',
  cursor: 'cli',
};

function includeFakeProvider(): boolean {
  return process.env.ROLEFLOCK_INCLUDE_FAKE === '1';
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
 * ROLEFLOCK_INCLUDE_FAKE=1.
 */
export class ProviderRegistry {
  private readonly adapters = new AdapterRegistry();
  private readonly customNames = new Map<string, string>();
  private readonly discovery = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor() {
    this.adapters.register(new FakeProvider());
    this.adapters.register(new ClaudeAdapter());
    this.adapters.register(new CodexAdapter());
    this.adapters.register(new CursorWriterAdapter(createFsCursorWriter()));

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

  has(id: string): boolean {
    try {
      this.adapters.get(id);
      return true;
    } catch {
      return false;
    }
  }

  registerCustom(input: CustomProviderInput): RegisteredProvider {
    const id =
      input.id?.trim() ||
      `custom_${input.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`.replace(/^_|_$/g, '');
    if (this.has(id)) {
      throw new Error(`Provider already registered: ${id}`);
    }
    if (!input.endpoint.trim() || !input.model.trim()) {
      throw new Error('endpoint and model are required');
    }
    this.adapters.register(
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

  async list(
    options: { includeFake?: boolean; fresh?: boolean } = {},
  ): Promise<RegisteredProvider[]> {
    const showFake = options.includeFake ?? includeFakeProvider();
    const fresh = options.fresh ?? false;
    const adapters = this.adapters.list().filter((adapter) => showFake || adapter.id !== 'fake');
    return Promise.all(
      adapters.map(async (adapter) => {
        const [health, capabilities, account] = await Promise.all([
          this.healthCheck(adapter.id, { fresh }),
          this.capabilities(adapter.id, { fresh }),
          this.account(adapter.id, { fresh }),
        ]);
        return {
          id: adapter.id,
          displayName: this.customNames.get(adapter.id) ?? providerNames[adapter.id] ?? adapter.id,
          status: health.status,
          health,
          capabilities,
          connectionType: connectionTypes[adapter.id] ?? 'cli',
          account,
        };
      }),
    );
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
      if (connectionTypes[id] === 'cli' || ['claude', 'codex', 'cursor'].includes(id)) {
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
    return (await this.get(id).listModels?.()) ?? [];
  }

  async authAction(id: string, action: 'login' | 'logout' | 'switch'): Promise<AuthActionResult> {
    if (!this.has(id)) throw new Error(`Provider not found: ${id}`);
    const result = await runProviderAuthAction(id, action);
    this.invalidate(id);
    return result;
  }
}

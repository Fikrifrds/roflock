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
 * The daemon's provider inventory. CLI-backed providers are listed even when
 * missing so callers can show their real installation state. Fake stays
 * registered for offline fallback but is hidden from the Providers UI unless
 * ROLEFLOCK_INCLUDE_FAKE=1.
 */
export class ProviderRegistry {
  private readonly adapters = new AdapterRegistry();
  private readonly customNames = new Map<string, string>();

  constructor() {
    this.adapters.register(new FakeProvider());
    this.adapters.register(new ClaudeAdapter());
    this.adapters.register(new CodexAdapter());
    this.adapters.register(new CursorWriterAdapter(createFsCursorWriter()));

    void Promise.all(this.adapters.list().map((adapter) => this.healthCheck(adapter.id))).catch(
      () => undefined,
    );
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
      `custom_${input.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`.replace(
        /^_|_$/g,
        '',
      );
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

  async list(options: { includeFake?: boolean } = {}): Promise<RegisteredProvider[]> {
    const showFake = options.includeFake ?? includeFakeProvider();
    const adapters = this.adapters
      .list()
      .filter((adapter) => showFake || adapter.id !== 'fake');
    return Promise.all(
      adapters.map(async (adapter) => {
        const base = (await adapter.healthCheck?.()) ?? { status: 'ready' as const };
        const account =
          adapter.id === 'fake'
            ? undefined
            : await getProviderAccount(adapter.id).catch(() => undefined);
        const health = mergeAccountIntoHealth(base, account);
        return {
          id: adapter.id,
          displayName:
            this.customNames.get(adapter.id) ?? providerNames[adapter.id] ?? adapter.id,
          status: health.status,
          health,
          capabilities: await this.capabilities(adapter.id),
          connectionType: connectionTypes[adapter.id] ?? 'cli',
          account,
        };
      }),
    );
  }

  async healthCheck(id: string): Promise<ProviderHealth> {
    const adapter = this.get(id);
    const base = (await adapter.healthCheck?.()) ?? { status: 'ready' as const };
    if (id === 'fake' || base.status === 'missing' || base.status === 'error') {
      return base;
    }
    if (connectionTypes[id] === 'cli' || ['claude', 'codex', 'cursor'].includes(id)) {
      const account = await getProviderAccount(id, { fresh: true });
      return mergeAccountIntoHealth(base, account);
    }
    return base;
  }

  async capabilities(id: string): Promise<ProviderCapabilities> {
    const adapter = this.get(id);
    return adapter.detectCapabilities?.() ?? adapter.capabilities;
  }

  async models(id: string): Promise<ProviderModel[]> {
    return (await this.get(id).listModels?.()) ?? [];
  }

  async authAction(
    id: string,
    action: 'login' | 'logout' | 'switch',
  ): Promise<AuthActionResult> {
    if (!this.has(id)) throw new Error(`Provider not found: ${id}`);
    return runProviderAuthAction(id, action);
  }
}

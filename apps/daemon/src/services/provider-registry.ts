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
import { CursorWriterAdapter } from '@roleflock/provider-cursor';

export interface RegisteredProvider {
  id: string;
  displayName: string;
  health: ProviderHealth;
  capabilities: ProviderCapabilities;
}

const providerNames: Record<string, string> = {
  fake: 'Phase 0 Fake Provider',
  claude: 'Claude CLI',
  codex: 'Codex CLI',
  cursor: 'Cursor Agent CLI',
};

/**
 * The daemon's provider inventory. CLI-backed providers are listed even when
 * missing so callers can show their real installation state.
 */
export class ProviderRegistry {
  private readonly adapters = new AdapterRegistry();

  constructor() {
    this.adapters.register(new FakeProvider());
    this.adapters.register(new ClaudeAdapter());
    this.adapters.register(new CodexAdapter());
    this.adapters.register(new CursorWriterAdapter());

    // Begin discovery immediately; API reads still run live checks so results
    // cannot become stale when a CLI is installed after daemon startup.
    void Promise.all(this.adapters.list().map((adapter) => this.healthCheck(adapter.id))).catch(() => undefined);
  }

  get(id: string): ProviderAdapter {
    return this.adapters.get(id);
  }

  async list(): Promise<RegisteredProvider[]> {
    return Promise.all(this.adapters.list().map(async (adapter) => ({
      id: adapter.id,
      displayName: providerNames[adapter.id] ?? adapter.id,
      health: await this.healthCheck(adapter.id),
      capabilities: await this.capabilities(adapter.id),
    })));
  }

  async healthCheck(id: string): Promise<ProviderHealth> {
    const adapter = this.get(id);
    return adapter.healthCheck?.() ?? { status: 'ready' };
  }

  async capabilities(id: string): Promise<ProviderCapabilities> {
    const adapter = this.get(id);
    return adapter.detectCapabilities?.() ?? adapter.capabilities;
  }

  async models(id: string): Promise<ProviderModel[]> {
    return (await this.get(id).listModels?.()) ?? [];
  }
}

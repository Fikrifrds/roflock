import { describe, expect, it } from 'vitest';
import { FakeProvider } from '@roleflock/provider-core';
import { ProviderRegistry } from '../src/services/provider-registry.js';
import { routeRole } from '../src/services/role-routing.js';

describe('role routing', () => {
  it('forceFake always selects the fake provider', async () => {
    const registry = new ProviderRegistry();
    const route = await routeRole(registry, 'planner', { forceFake: true });
    expect(route.providerId).toBe('fake');
    expect(route.adapter).toBeInstanceOf(FakeProvider);
  });

  it('routes reviewer to a registered openai-compatible provider when ready', async () => {
    const registry = new ProviderRegistry();
    const registered = registry.registerCustom({
      displayName: 'Local LLM',
      endpoint: 'http://127.0.0.1:11434/v1',
      apiKey: '',
      model: 'llama3.2',
    });
    const route = await routeRole(registry, 'reviewer', { forceFake: false });
    expect(route.providerId).toBe(registered.id);
    expect(route.modelId).toBe('llama3.2');
    expect(route.fallbackUsed).toBe(false);
  });

  it('falls back to fake when preferred CLI is missing', async () => {
    const registry = new ProviderRegistry();
    const route = await routeRole(registry, 'planner', { forceFake: false });
    // On CI / machines without Claude CLI this is fake; with Claude installed it may be claude.
    expect(['fake', 'claude']).toContain(route.providerId);
    if (route.providerId === 'fake') expect(route.fallbackUsed).toBe(true);
  });
});

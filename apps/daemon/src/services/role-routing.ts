import type { ProviderAdapter, ProviderHealth } from '@roleflock/provider-core';
import type { ProviderRegistry, RegisteredProvider } from './provider-registry.js';

export type RoutedRole = 'planner' | 'reviewer' | 'writer' | 'verifier';

export interface RoleRoute {
  role: RoutedRole;
  providerId: string;
  providerDisplayName: string;
  modelId: string;
  modelDisplayName: string;
  adapter: ProviderAdapter;
  fallbackUsed: boolean;
}

/** Preference tokens: concrete provider ids, or `custom` for any openai-compatible entry. */
const ROLE_PREFERENCE: Record<RoutedRole, string[]> = {
  planner: ['claude', 'fake'],
  reviewer: ['custom', 'fake'],
  writer: ['cursor', 'fake'],
  verifier: ['codex', 'fake'],
};

/**
 * Prefer the strongest installed provider for a role, otherwise fall back to fake.
 * Tests and offline runs stay deterministic because missing CLIs resolve to fake.
 */
export async function routeRole(
  registry: ProviderRegistry,
  role: RoutedRole,
  options: { forceFake?: boolean } = {},
): Promise<RoleRoute> {
  if (options.forceFake) {
    return fakeRoute(registry, role, false);
  }

  const listed = await registry.list();
  let sawUnreadyPreferred = false;

  for (const preference of ROLE_PREFERENCE[role]) {
    const candidates = resolveCandidates(preference, listed);
    for (const candidate of candidates) {
      let adapter: ProviderAdapter;
      try {
        adapter = registry.get(candidate.id);
      } catch {
        continue;
      }

      const health: ProviderHealth = await registry.healthCheck(candidate.id);
      if (health.status !== 'ready') {
        sawUnreadyPreferred = true;
        continue;
      }

      const models = await registry.models(candidate.id);
      const model = models[0];
      return {
        role,
        providerId: candidate.id,
        providerDisplayName: candidate.displayName,
        modelId: model?.id ?? `${candidate.id}-default`,
        modelDisplayName: model?.displayName ?? `${candidate.id} default`,
        adapter,
        fallbackUsed: false,
      };
    }
  }

  return fakeRoute(registry, role, sawUnreadyPreferred);
}

function resolveCandidates(
  preference: string,
  listed: RegisteredProvider[],
): RegisteredProvider[] {
  if (preference === 'custom') {
    return listed.filter((item) => item.connectionType === 'openai-compatible');
  }
  const exact = listed.find((item) => item.id === preference);
  return exact ? [exact] : [];
}

function fakeRoute(
  registry: ProviderRegistry,
  role: RoutedRole,
  fallbackUsed: boolean,
): RoleRoute {
  const fake = registry.get('fake');
  return {
    role,
    providerId: 'fake',
    providerDisplayName: 'Phase 0 Fake Provider',
    modelId: 'phase0-fake',
    modelDisplayName: 'Phase 0 Fake',
    adapter: fake,
    fallbackUsed,
  };
}

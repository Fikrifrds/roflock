import { describe, expect, it } from 'vitest';
import { ProviderRegistry } from '../src/services/provider-registry.js';

describe('provider registry listing', () => {
  it('hides the Phase 0 fake provider from the public inventory by default', async () => {
    const include = process.env.ROLEFLOCK_INCLUDE_FAKE;
    const force = process.env.ROLEFLOCK_FORCE_FAKE;
    delete process.env.ROLEFLOCK_INCLUDE_FAKE;
    delete process.env.ROLEFLOCK_FORCE_FAKE;
    try {
      const registry = new ProviderRegistry();
      const listed = await registry.list();
      expect(listed.some((provider) => provider.id === 'fake')).toBe(false);
      expect(listed.some((provider) => provider.id === 'claude')).toBe(true);
      // Not merely hidden from the list — not registered at all, so it cannot
      // be picked on the Roles page and cannot be routed to by accident.
      expect(registry.has('fake')).toBe(false);
    } finally {
      if (include === undefined) delete process.env.ROLEFLOCK_INCLUDE_FAKE;
      else process.env.ROLEFLOCK_INCLUDE_FAKE = include;
      if (force === undefined) delete process.env.ROLEFLOCK_FORCE_FAKE;
      else process.env.ROLEFLOCK_FORCE_FAKE = force;
    }
  });

  it('registers and lists the stand-in when explicitly enabled', async () => {
    const previous = process.env.ROLEFLOCK_INCLUDE_FAKE;
    process.env.ROLEFLOCK_INCLUDE_FAKE = '1';
    try {
      const registry = new ProviderRegistry();
      const listed = await registry.list();
      expect(listed.some((provider) => provider.id === 'fake')).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ROLEFLOCK_INCLUDE_FAKE;
      else process.env.ROLEFLOCK_INCLUDE_FAKE = previous;
    }
  });
});

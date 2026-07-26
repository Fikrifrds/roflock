import { describe, expect, it } from 'vitest';
import { ProviderRegistry } from '../src/services/provider-registry.js';

describe('provider registry listing', () => {
  it('hides the Phase 0 fake provider from the public inventory by default', async () => {
    const previous = process.env.ROLEFLOCK_INCLUDE_FAKE;
    delete process.env.ROLEFLOCK_INCLUDE_FAKE;
    try {
      const registry = new ProviderRegistry();
      const listed = await registry.list();
      expect(listed.some((provider) => provider.id === 'fake')).toBe(false);
      expect(listed.some((provider) => provider.id === 'claude')).toBe(true);
      expect(registry.has('fake')).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ROLEFLOCK_INCLUDE_FAKE;
      else process.env.ROLEFLOCK_INCLUDE_FAKE = previous;
    }
  });

  it('can include fake when ROLEFLOCK_INCLUDE_FAKE=1', async () => {
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

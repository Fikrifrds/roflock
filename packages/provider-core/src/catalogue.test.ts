import { describe, expect, it } from 'vitest';
import { normalizeProviderModel } from './index.js';

describe('provider model catalogue normalization', () => {
  it('combines runtime adapter capabilities with sourced model metadata', () => {
    const model = normalizeProviderModel(
      'codex',
      {
        streaming: true,
        tools: true,
        writes: true,
        patches: true,
        headless: true,
      },
      {
        id: 'model-a',
        displayName: 'Model A',
        family: 'family-a',
        catalogueSource: 'curated_alias',
        supportedEffort: ['low', 'high'],
        maxContextTokens: 200_000,
      },
    );
    expect(model).toMatchObject({
      providerId: 'codex',
      modelId: 'model-a',
      modelFamily: 'family-a',
      capabilities: {
        tools: true,
        writes: true,
        patches: true,
        headless: true,
      },
      capabilitySource: 'runtime_detected',
      metadataSource: 'curated_alias',
      supportedEffort: ['low', 'high'],
      maxContextTokens: 200_000,
    });
  });

  it('keeps unavailable metadata unknown instead of filling catalogue defaults', () => {
    const model = normalizeProviderModel(
      'custom',
      { streaming: true, tools: false, writes: false, headless: true },
      { id: 'unknown-model', displayName: 'Unknown model', catalogueSource: 'configured' },
    );
    expect(model.modelFamily).toBeUndefined();
    expect(model.maxContextTokens).toBeUndefined();
    expect(model.supportedEffort).toBeUndefined();
    expect(model.costClass).toBeUndefined();
    expect(model.latencyClass).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
  budgetStatus,
  estimateInvocationCost,
  findPriceCard,
  DEFAULT_PRICE_CARDS,
} from './index.js';

describe('usage ledger pricing', () => {
  it('keeps fake actual cost at zero while tracking shadow separately', () => {
    const cost = estimateInvocationCost({
      tokens: { inputTokens: 100_000, outputTokens: 50_000 },
      providerConnectionId: 'fake',
      modelId: 'phase0-fake',
    });
    expect(cost.actualCostUsd).toBe(0);
    expect(cost.shadowCostUsd).toBeGreaterThan(0);
    expect(cost.confidence).toBe('exact');
  });

  it('estimates live provider actual from the price card without merging labels', () => {
    const card = findPriceCard(DEFAULT_PRICE_CARDS, 'claude', 'claude-code');
    expect(card).toBeTruthy();
    const cost = estimateInvocationCost({
      tokens: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      providerConnectionId: 'claude',
      modelId: 'claude-code',
    });
    expect(cost.actualCostUsd).toBe(18);
    expect(cost.shadowCostUsd).toBe(18);
    expect(cost.confidence).toBe('estimated');
  });

  it('reports budget warning and hard stop thresholds separately', () => {
    expect(
      budgetStatus({ actualCostUsd: 0.85, maxActualCostUsd: 1 }).warning,
    ).toBe(true);
    expect(
      budgetStatus({ actualCostUsd: 0.85, maxActualCostUsd: 1 }).hardStop,
    ).toBe(false);
    expect(
      budgetStatus({ actualCostUsd: 1, maxActualCostUsd: 1 }).hardStop,
    ).toBe(true);
  });
});

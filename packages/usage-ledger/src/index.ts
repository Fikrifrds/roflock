import type { UsageConfidence } from '@roleflock/contracts';

export interface PriceCard {
  id: string;
  providerConnectionId: string;
  modelId: string;
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  currency: 'USD';
  effectiveAt: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CostEstimate {
  actualCostUsd: number;
  shadowCostUsd: number;
  confidence: UsageConfidence;
  priceCardId?: string;
}

export interface BudgetStatus {
  maxActualCostUsd?: number;
  actualCostUsd: number;
  remainingUsd?: number;
  warning: boolean;
  hardStop: boolean;
  warningThreshold: number;
}

export interface QuotaSnapshotView {
  id: string;
  providerConnectionId: string;
  remaining?: number;
  limit?: number;
  resetAt?: string;
  confidence: UsageConfidence;
  source: 'local_meter' | 'provider_reported' | 'manual' | 'unknown';
  capturedAt: string;
  note: string;
}

/** Default local shadow prices — never treated as a provider invoice. */
export const DEFAULT_PRICE_CARDS: PriceCard[] = [
  {
    id: 'price_fake',
    providerConnectionId: 'fake',
    modelId: 'phase0-fake',
    inputPerMTokUsd: 0.5,
    outputPerMTokUsd: 1.5,
    currency: 'USD',
    effectiveAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'price_claude',
    providerConnectionId: 'claude',
    modelId: 'claude-code',
    inputPerMTokUsd: 3,
    outputPerMTokUsd: 15,
    currency: 'USD',
    effectiveAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'price_codex',
    providerConnectionId: 'codex',
    modelId: 'codex',
    inputPerMTokUsd: 2,
    outputPerMTokUsd: 8,
    currency: 'USD',
    effectiveAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'price_cursor',
    providerConnectionId: 'cursor',
    modelId: 'cursor-agent',
    inputPerMTokUsd: 2.5,
    outputPerMTokUsd: 10,
    currency: 'USD',
    effectiveAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'price_custom',
    providerConnectionId: 'custom',
    modelId: '*',
    inputPerMTokUsd: 1,
    outputPerMTokUsd: 3,
    currency: 'USD',
    effectiveAt: '2026-01-01T00:00:00.000Z',
  },
];

export function findPriceCard(
  cards: readonly PriceCard[],
  providerConnectionId: string,
  modelId: string,
): PriceCard | undefined {
  return (
    cards.find(
      (card) =>
        card.providerConnectionId === providerConnectionId && card.modelId === modelId,
    ) ??
    cards.find(
      (card) =>
        card.providerConnectionId === providerConnectionId && card.modelId === '*',
    ) ??
    cards.find((card) => card.providerConnectionId === 'custom' && card.modelId === '*')
  );
}

/**
 * Shadow cost is always estimated from the local price card.
 * Actual cost is 0 for unmetered/fake local runs, or the estimated billable
 * amount when a live provider is used (still confidence=estimated until a
 * provider reports exact usage).
 */
export function estimateInvocationCost(input: {
  tokens: TokenUsage;
  providerConnectionId: string;
  modelId: string;
  cards?: readonly PriceCard[];
  providerReportsExact?: boolean;
}): CostEstimate {
  const cards = input.cards ?? DEFAULT_PRICE_CARDS;
  const card = findPriceCard(cards, input.providerConnectionId, input.modelId);
  const shadow =
    ((input.tokens.inputTokens / 1_000_000) * (card?.inputPerMTokUsd ?? 1) +
      (input.tokens.outputTokens / 1_000_000) * (card?.outputPerMTokUsd ?? 3)) ||
    0.01;

  if (input.providerConnectionId === 'fake' || input.providerConnectionId === 'deterministic') {
    return {
      actualCostUsd: 0,
      shadowCostUsd: Number(shadow.toFixed(6)),
      confidence: 'exact',
      priceCardId: card?.id,
    };
  }

  return {
    actualCostUsd: Number(shadow.toFixed(6)),
    shadowCostUsd: Number(shadow.toFixed(6)),
    confidence: input.providerReportsExact ? 'provider_reported' : 'estimated',
    priceCardId: card?.id,
  };
}

export function budgetStatus(input: {
  actualCostUsd: number;
  maxActualCostUsd?: number;
  warningThreshold?: number;
}): BudgetStatus {
  const warningThreshold = input.warningThreshold ?? 0.8;
  if (input.maxActualCostUsd === undefined) {
    return {
      actualCostUsd: input.actualCostUsd,
      warning: false,
      hardStop: false,
      warningThreshold,
    };
  }
  const remainingUsd = Math.max(0, input.maxActualCostUsd - input.actualCostUsd);
  return {
    maxActualCostUsd: input.maxActualCostUsd,
    actualCostUsd: input.actualCostUsd,
    remainingUsd,
    warning:
      input.maxActualCostUsd > 0 &&
      input.actualCostUsd / input.maxActualCostUsd >= warningThreshold &&
      input.actualCostUsd < input.maxActualCostUsd,
    hardStop: input.actualCostUsd >= input.maxActualCostUsd,
    warningThreshold,
  };
}

export function localQuotaPlaceholder(providerConnectionId: string): QuotaSnapshotView {
  return {
    id: `quota_local_${providerConnectionId}`,
    providerConnectionId,
    confidence: 'unknown',
    source: 'unknown',
    capturedAt: new Date().toISOString(),
    note: 'Account-wide quota is not available locally. This meter only reflects RoleFlock daemon usage.',
  };
}

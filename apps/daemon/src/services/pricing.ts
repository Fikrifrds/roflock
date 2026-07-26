import {
  PriceCardRepository,
  QuotaSnapshotRepository,
  type SqliteDb,
} from '@roleflock/database';
import {
  DEFAULT_PRICE_CARDS,
  localQuotaPlaceholder,
  type PriceCard,
} from '@roleflock/usage-ledger';

/** Seed default local price cards and honest unknown quota placeholders. */
export function seedPricingDefaults(db: SqliteDb): void {
  const prices = new PriceCardRepository(db);
  for (const card of DEFAULT_PRICE_CARDS) {
    prices.upsert({
      id: card.id,
      providerConnectionId: card.providerConnectionId,
      modelId: card.modelId,
      inputPerMTokUsd: card.inputPerMTokUsd,
      outputPerMTokUsd: card.outputPerMTokUsd,
      currency: card.currency,
      effectiveAt: card.effectiveAt,
    });
  }

  const quotas = new QuotaSnapshotRepository(db);
  for (const providerId of ['claude', 'codex', 'cursor']) {
    const placeholder = localQuotaPlaceholder(providerId);
    quotas.upsert({
      id: placeholder.id,
      providerConnectionId: providerId,
      snapshotJson: JSON.stringify(placeholder),
      confidence: placeholder.confidence,
      capturedAt: placeholder.capturedAt,
    });
  }
}

export function loadPriceCards(db: SqliteDb): PriceCard[] {
  return new PriceCardRepository(db).list().map((row) => ({
    id: row.id,
    providerConnectionId: row.providerConnectionId,
    modelId: row.modelId,
    inputPerMTokUsd: row.inputPerMTokUsd ?? 1,
    outputPerMTokUsd: row.outputPerMTokUsd ?? 3,
    currency: 'USD',
    effectiveAt: row.effectiveAt,
  }));
}

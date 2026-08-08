import type { SqliteDb } from '../client.js';

export interface PriceCardRow {
  id: string;
  providerConnectionId: string;
  modelId: string;
  inputPerMTokUsd?: number;
  outputPerMTokUsd?: number;
  currency: string;
  effectiveAt: string;
}

export class PriceCardRepository {
  constructor(private readonly db: SqliteDb) {}

  upsert(card: PriceCardRow): PriceCardRow {
    this.db
      .prepare(
        `INSERT INTO price_cards
          (id, provider_connection_id, model_id, input_per_mtok_usd, output_per_mtok_usd, currency, effective_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider_connection_id = excluded.provider_connection_id,
           model_id = excluded.model_id,
           input_per_mtok_usd = excluded.input_per_mtok_usd,
           output_per_mtok_usd = excluded.output_per_mtok_usd,
           currency = excluded.currency,
           effective_at = excluded.effective_at`,
      )
      .run(
        card.id,
        card.providerConnectionId,
        card.modelId,
        card.inputPerMTokUsd ?? null,
        card.outputPerMTokUsd ?? null,
        card.currency,
        card.effectiveAt,
      );
    return card;
  }

  list(): PriceCardRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM price_cards ORDER BY provider_connection_id, model_id`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      providerConnectionId: String(row.provider_connection_id),
      modelId: String(row.model_id),
      inputPerMTokUsd: row.input_per_mtok_usd === null ? undefined : Number(row.input_per_mtok_usd),
      outputPerMTokUsd:
        row.output_per_mtok_usd === null ? undefined : Number(row.output_per_mtok_usd),
      currency: String(row.currency),
      effectiveAt: String(row.effective_at),
    }));
  }
}

export interface QuotaSnapshotRow {
  id: string;
  providerConnectionId: string;
  snapshotJson: string;
  confidence: string;
  capturedAt: string;
}

export class QuotaSnapshotRepository {
  constructor(private readonly db: SqliteDb) {}

  upsert(row: QuotaSnapshotRow): QuotaSnapshotRow {
    this.db
      .prepare(
        `INSERT INTO quota_snapshots (id, provider_connection_id, snapshot_json, confidence, captured_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           snapshot_json = excluded.snapshot_json,
           confidence = excluded.confidence,
           captured_at = excluded.captured_at`,
      )
      .run(row.id, row.providerConnectionId, row.snapshotJson, row.confidence, row.capturedAt);
    return row;
  }

  list(): QuotaSnapshotRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM quota_snapshots ORDER BY captured_at DESC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      providerConnectionId: String(row.provider_connection_id),
      snapshotJson: String(row.snapshot_json),
      confidence: String(row.confidence),
      capturedAt: String(row.captured_at),
    }));
  }
}

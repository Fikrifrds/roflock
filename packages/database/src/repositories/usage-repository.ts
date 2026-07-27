import type { SqliteDb } from '../client.js';

export interface UsageEntry {
  id: string;
  taskId: string;
  invocationId?: string;
  providerConnectionId?: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  actualCostUsd?: number;
  shadowCostUsd?: number;
  confidence: string;
  createdAt: string;
}

export interface ProviderModelUsage {
  providerConnectionId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  entryCount: number;
}

export class UsageRepository {
  constructor(private readonly db: SqliteDb) {}

  append(entry: UsageEntry & { providerConnectionId: string; modelId: string }): UsageEntry {
    if (!entry.providerConnectionId.trim() || !entry.modelId.trim()) {
      throw new Error('Usage entries require both providerConnectionId and modelId.');
    }
    this.db
      .prepare(
        `INSERT INTO usage_ledger_entries
          (id, task_id, invocation_id, provider_connection_id, model_id, input_tokens, output_tokens,
           actual_cost_usd, shadow_cost_usd, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.taskId,
        entry.invocationId ?? null,
        entry.providerConnectionId ?? null,
        entry.modelId ?? null,
        entry.inputTokens ?? null,
        entry.outputTokens ?? null,
        entry.actualCostUsd ?? null,
        entry.shadowCostUsd ?? null,
        entry.confidence,
        entry.createdAt,
      );
    return entry;
  }

  listByTask(taskId: string): UsageEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM usage_ledger_entries WHERE task_id = ? ORDER BY created_at ASC`)
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      invocationId: row.invocation_id ? String(row.invocation_id) : undefined,
      providerConnectionId: row.provider_connection_id
        ? String(row.provider_connection_id)
        : undefined,
      modelId: row.model_id ? String(row.model_id) : undefined,
      inputTokens: row.input_tokens === null ? undefined : Number(row.input_tokens),
      outputTokens: row.output_tokens === null ? undefined : Number(row.output_tokens),
      actualCostUsd: row.actual_cost_usd === null ? undefined : Number(row.actual_cost_usd),
      shadowCostUsd: row.shadow_cost_usd === null ? undefined : Number(row.shadow_cost_usd),
      confidence: String(row.confidence),
      createdAt: String(row.created_at),
    }));
  }

  summarize(taskId: string): {
    actualCostUsd: number;
    shadowCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    entryCount: number;
  } {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(actual_cost_usd), 0) AS actual,
                COALESCE(SUM(shadow_cost_usd), 0) AS shadow,
                COALESCE(SUM(input_tokens), 0) AS inputTokens,
                COALESCE(SUM(output_tokens), 0) AS outputTokens,
                COUNT(*) AS entryCount
         FROM usage_ledger_entries WHERE task_id = ?`,
      )
      .get(taskId) as {
      actual: number;
      shadow: number;
      inputTokens: number;
      outputTokens: number;
      entryCount: number;
    };
    return {
      actualCostUsd: row.actual,
      shadowCostUsd: row.shadow,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      entryCount: row.entryCount,
    };
  }

  summarizeByProvider(providerConnectionId: string): {
    actualCostUsd: number;
    shadowCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    entryCount: number;
  } {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(actual_cost_usd), 0) AS actual,
                COALESCE(SUM(shadow_cost_usd), 0) AS shadow,
                COALESCE(SUM(input_tokens), 0) AS inputTokens,
                COALESCE(SUM(output_tokens), 0) AS outputTokens,
                COUNT(*) AS entryCount
         FROM usage_ledger_entries WHERE provider_connection_id = ?`,
      )
      .get(providerConnectionId) as {
      actual: number;
      shadow: number;
      inputTokens: number;
      outputTokens: number;
      entryCount: number;
    };
    return {
      actualCostUsd: row.actual,
      shadowCostUsd: row.shadow,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      entryCount: row.entryCount,
    };
  }

  summarizeByProviderAndModel(providerConnectionId?: string): ProviderModelUsage[] {
    const rows = this.db
      .prepare(
        `SELECT provider_connection_id AS providerConnectionId,
                model_id AS modelId,
                COALESCE(SUM(input_tokens), 0) AS inputTokens,
                COALESCE(SUM(output_tokens), 0) AS outputTokens,
                COUNT(*) AS entryCount
         FROM usage_ledger_entries
         WHERE provider_connection_id IS NOT NULL
           AND model_id IS NOT NULL
           ${providerConnectionId ? 'AND provider_connection_id = ?' : ''}
         GROUP BY provider_connection_id, model_id
         ORDER BY (COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0)) DESC,
                  provider_connection_id ASC,
                  model_id ASC`,
      )
      .all(...(providerConnectionId ? [providerConnectionId] : [])) as ProviderModelUsage[];
    return rows.map((row) => ({
      providerConnectionId: String(row.providerConnectionId),
      modelId: String(row.modelId),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      entryCount: Number(row.entryCount),
    }));
  }
}

export interface UsageRecord { invocationId: string; provider: string; model: string; inputTokens?: number; outputTokens?: number; costUsd?: number; recordedAt: string; confidence?: 'exact' | 'provider_reported' | 'estimated' | 'unknown'; }
export interface UsageSummary { inputTokens: number; outputTokens: number; costUsd: number; records: number; }
export class UsageLedger {
  private readonly records: UsageRecord[] = [];
  record(record: UsageRecord): void { if (this.records.some((item) => item.invocationId === record.invocationId)) throw new Error(`Usage already recorded: ${record.invocationId}`); this.records.push({ ...record, confidence: record.confidence ?? 'provider_reported' }); }
  summarize(filter: Partial<Pick<UsageRecord, 'provider' | 'model'>> = {}): UsageSummary { const records = this.records.filter((r) => (!filter.provider || r.provider === filter.provider) && (!filter.model || r.model === filter.model)); return records.reduce((total, r) => ({ inputTokens: total.inputTokens + (r.inputTokens ?? 0), outputTokens: total.outputTokens + (r.outputTokens ?? 0), costUsd: total.costUsd + (r.costUsd ?? 0), records: total.records + 1 }), { inputTokens: 0, outputTokens: 0, costUsd: 0, records: 0 }); }
  entries(): readonly UsageRecord[] { return this.records; }
}

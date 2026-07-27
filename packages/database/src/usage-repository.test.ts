import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase } from './client.js';
import { UsageRepository } from './repositories/usage-repository.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function repository() {
  const dir = mkdtempSync(join(tmpdir(), 'roleflock-usage-'));
  dirs.push(dir);
  return new UsageRepository(openMigratedDatabase(join(dir, 'test.db')));
}

describe('usage repository', () => {
  it('stores and aggregates tokens independently for every provider and model', () => {
    const usage = repository();
    const entry = (
      id: string,
      providerConnectionId: string,
      modelId: string,
      inputTokens: number,
      outputTokens: number,
    ) =>
      usage.append({
        id,
        taskId: 'task-1',
        providerConnectionId,
        modelId,
        inputTokens,
        outputTokens,
        confidence: 'provider_reported',
        createdAt: `2026-07-27T00:00:0${id}.000Z`,
      });

    entry('1', 'codex', 'gpt-5.6-sol', 100, 20);
    entry('2', 'codex', 'gpt-5.6-sol', 50, 10);
    entry('3', 'codex', 'gpt-5.6-terra', 40, 5);
    entry('4', 'cursor', 'composer-2.5', 30, 6);

    expect(usage.summarizeByProviderAndModel('codex')).toEqual([
      {
        providerConnectionId: 'codex',
        modelId: 'gpt-5.6-sol',
        inputTokens: 150,
        outputTokens: 30,
        entryCount: 2,
      },
      {
        providerConnectionId: 'codex',
        modelId: 'gpt-5.6-terra',
        inputTokens: 40,
        outputTokens: 5,
        entryCount: 1,
      },
    ]);
    expect(usage.summarizeByProviderAndModel()).toHaveLength(3);
  });

  it('rejects usage without an attributable provider and model', () => {
    const usage = repository();
    expect(() =>
      usage.append({
        id: 'missing-model',
        taskId: 'task-1',
        providerConnectionId: 'codex',
        modelId: '',
        confidence: 'unknown',
        createdAt: '2026-07-27T00:00:00.000Z',
      }),
    ).toThrow(/require both providerConnectionId and modelId/);
  });
});

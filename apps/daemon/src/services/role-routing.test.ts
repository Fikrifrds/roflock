import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type SqliteDb } from '@roleflock/database';
import type { ProviderAdapter } from '@roleflock/provider-core';
import { RoleRouter } from './role-routing.js';
import type { ProviderRegistry } from './provider-registry.js';

let db: SqliteDb | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

describe('RoleRouter task pinning', () => {
  it('routes a task through its recommendation roster despite later global edits', async () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    const adapter: ProviderAdapter = {
      id: 'codex',
      capabilities: {
        streaming: true,
        tools: true,
        writes: true,
        patches: true,
        headless: true,
        structuredOutput: true,
      },
      async *invoke() {
        yield { type: 'invocation.completed', output: 'ok' };
      },
    };
    const registry = {
      get: () => adapter,
      healthCheck: async () => ({ status: 'ready' as const }),
      list: async () => [
        {
          id: 'codex',
          displayName: 'Codex CLI',
        },
      ],
      models: async () => [
        { id: 'task-model', displayName: 'Pinned task model' },
        { id: 'global-model', displayName: 'Global model' },
      ],
    } as unknown as ProviderRegistry;
    const router = new RoleRouter(db, registry);
    router.replaceTaskRole(
      'task_1',
      'writer',
      [{ providerConnectionId: 'codex', modelId: 'task-model', effort: 'high' }],
      { recommendationId: 'recommendation_1', recommendationActionId: 'action_1' },
    );
    router.replaceRole('writer', [
      { providerConnectionId: 'codex', modelId: 'global-model', effort: 'medium' },
    ]);

    await expect(router.route('writer', { taskId: 'task_1' })).resolves.toMatchObject({
      providerId: 'codex',
      modelId: 'task-model',
      modelDisplayName: 'Pinned task model',
      effort: 'high',
    });
    await expect(router.route('writer')).resolves.toMatchObject({
      providerId: 'codex',
      modelId: 'global-model',
      effort: 'medium',
    });
  });
});

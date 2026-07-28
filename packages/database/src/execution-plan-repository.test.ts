import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sealExecutionPlan,
  sealPlanDeviation,
  type UnhashedExecutionPlan,
} from '@roleflock/change-contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase } from './client.js';
import {
  ExecutionPlanRepository,
  planSnapshotId,
} from './repositories/execution-plan-repository.js';

const directories: string[] = [];
afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function planInput(version = 1): UnhashedExecutionPlan {
  return {
    id: 'plan_1',
    taskId: 'task_1',
    contractId: 'contract_1',
    contractHash: 'a'.repeat(64),
    version,
    status: 'proposed',
    summary: `Plan version ${version}.`,
    assumptions: [],
    steps: [
      {
        id: 'STEP-1',
        objective: 'Update checkout.',
        criterionIds: ['AC-1'],
        allowedOperations: ['modify_file', 'run_command'],
        expectedFiles: ['src/checkout.ts'],
        completionEvidenceIds: ['E-1'],
      },
    ],
    allowedPaths: ['src'],
    expectedChangedPaths: ['src/checkout.ts'],
    forbiddenPaths: ['infra'],
    dependencyChanges: [],
    migrationActions: [],
    verificationSpecId: 'verification_1',
    repairEnvelope: {
      allowedFailureClasses: [],
      maxAttempts: 0,
      mayAddFiles: false,
      mayChangeDependencies: false,
      mayChangePublicApi: false,
      mayChangeSchema: false,
      pathScope: ['src'],
    },
    changeBudget: {
      maxChangedFiles: 2,
      maxAddedLines: 100,
      maxDeletedLines: 100,
      maxNewDependencies: 0,
    },
    decisionLog: [],
    proposedBy: {
      invocationId: `planner_${version}`,
      role: 'planner',
      providerId: 'provider_a',
      modelId: 'model_a',
    },
  };
}

describe('ExecutionPlanRepository', () => {
  it('preserves proposed, approved, deviation, and revised snapshots', () => {
    const directory = mkdtempSync(join(tmpdir(), 'roleflock-plans-'));
    directories.push(directory);
    const db = openMigratedDatabase(join(directory, 'test.db'));
    const repository = new ExecutionPlanRepository(db);
    const proposed = sealExecutionPlan(planInput());
    expect(repository.create(proposed)).toMatchObject({ revision: 1, status: 'proposed' });

    const approved = repository.approve(
      proposed.id,
      1,
      { actorId: 'user_1', actorType: 'human' },
      '2026-07-28T10:00:00.000Z',
    );
    expect(approved).toMatchObject({
      aggregate: { revision: 2, status: 'approved' },
      plan: { status: 'approved', version: 1 },
    });

    const deviation = sealPlanDeviation({
      id: 'deviation_1',
      planId: approved.plan.id,
      planHash: approved.plan.hash,
      detectedBy: 'human',
      type: 'scope_expansion',
      evidence: [{ id: 'evidence_1', digest: 'b'.repeat(64) }],
      proposedOptions: ['Revise the plan.'],
      status: 'open',
    });
    repository.addDeviation('task_1', deviation, '2026-07-28T10:05:00.000Z');

    const revised = sealExecutionPlan({
      ...planInput(2),
      parentPlanId: planSnapshotId(approved.plan),
      revisionReason: 'Handle the reported deviation.',
    });
    expect(repository.revise(proposed.id, 2, revised)).toMatchObject({
      aggregate: { revision: 3, currentVersion: 2, status: 'proposed' },
    });
    expect(repository.listSnapshots(proposed.id)).toHaveLength(3);
    expect(repository.listDeviations('task_1')).toEqual([deviation]);

    expect(() =>
      db.prepare(`UPDATE execution_plan_snapshots SET status = 'cancelled'`).run(),
    ).toThrow(/immutable/);
  });
});

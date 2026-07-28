import { FakeClock } from '@roleflock/contracts';
import {
  ChangeContractRepository,
  openMigratedDatabase,
  TaskRepository,
} from '@roleflock/database';
import { ChangeContractService, type UnhashedChangeContract } from '@roleflock/change-contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateContractStartGate } from '../src/services/contract-start-gate.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'roleflock-start-gate-'));
  directories.push(directory);
  const db = openMigratedDatabase(join(directory, 'test.db'));
  const tasks = new TaskRepository(db);
  const contracts = new ChangeContractRepository(db);
  const baseTask = {
    id: 'task_1',
    projectId: 'project_1',
    type: 'bug_fix' as const,
    title: 'Idempotent checkout',
    brief: 'Prevent duplicate checkout.',
    risk: 'high' as const,
    state: 'ready' as const,
    workflowGraphVersionId: 'bug_fix@2',
    budgetPolicyId: 'local-default',
    maxAttempts: 3,
    createdAt: '2026-07-28T07:00:00.000Z',
    updatedAt: '2026-07-28T07:00:00.000Z',
  };
  return { db, tasks, contracts, baseTask };
}

function contractDraft(): UnhashedChangeContract {
  return {
    id: 'contract_1',
    taskId: 'task_1',
    projectId: 'project_1',
    repositoryId: 'project_1',
    version: 1,
    status: 'draft',
    objective: 'Prevent duplicate checkout.',
    acceptanceCriteria: [
      {
        id: 'AC-1',
        statement: 'A repeated request creates one order.',
        verificationType: 'automated_test',
        requiredEvidenceIds: ['E-1'],
      },
    ],
    prohibitedOutcomes: [],
    outOfScope: [],
    risk: 'high',
    requiredEvidence: [
      {
        id: 'E-1',
        type: 'test_result',
        description: 'Idempotency integration test.',
        mandatory: true,
      },
    ],
    authoritySources: [
      {
        id: 'SRC-1',
        kind: 'user_input',
        locator: 'task://task_1/brief',
        digest: 'a'.repeat(64),
      },
    ],
    unresolvedQuestions: [],
    draftedBy: 'planner_1',
    createdAt: '2026-07-28T07:00:00.000Z',
  };
}

describe('contract start gate', () => {
  it('blocks a newly persisted task without a Change Contract', () => {
    const { tasks, contracts, baseTask } = fixture();
    const task = tasks.upsert(baseTask);

    expect(task.contractRequirement).toBe('required');
    expect(tasks.get(task.id)?.contractRequirement).toBe('required');
    expect(evaluateContractStartGate(tasks.get(task.id)!, contracts)).toMatchObject({
      allowed: false,
      code: 'CHANGE_CONTRACT_REQUIRED',
    });
  });

  it('blocks drafts and returns an exact pin only after human authorisation', () => {
    const { tasks, contracts, baseTask } = fixture();
    tasks.upsert(baseTask);
    const clock = new FakeClock(new Date('2026-07-28T08:00:00.000Z'));
    const service = new ChangeContractService(contracts, clock);
    service.createDraft(contractDraft(), { actorId: 'planner_1' });

    expect(evaluateContractStartGate(tasks.get(baseTask.id)!, contracts)).toMatchObject({
      allowed: false,
      code: 'CHANGE_CONTRACT_NOT_AUTHORISED',
      contractStatus: 'draft',
    });

    service.requestAuthorisation('contract_1', 1, { actorId: 'planner_1' });
    const authorised = service.authorise('contract_1', 2, { actorId: 'authority_1' });
    expect(evaluateContractStartGate(tasks.get(baseTask.id)!, contracts)).toEqual({
      allowed: true,
      mode: 'authorised',
      pin: {
        contractId: 'contract_1',
        contractVersion: 1,
        contractHash: authorised.contract.hash,
      },
    });
  });

  it('allows a legacy row without pretending its brief was authorised', () => {
    const { tasks, contracts, baseTask } = fixture();
    tasks.upsert({ ...baseTask, contractRequirement: 'legacy_uncontracted' });
    const gate = evaluateContractStartGate(tasks.get(baseTask.id)!, contracts);

    expect(gate).toMatchObject({ allowed: true, mode: 'legacy_uncontracted' });
    if (gate.allowed && gate.mode === 'legacy_uncontracted') {
      expect(gate.warning).toMatch(/not represented as human-authorised/);
    }
  });
});

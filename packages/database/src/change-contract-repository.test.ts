import { sealChangeContract, type UnhashedChangeContract } from '@roleflock/change-contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase, type SqliteDb } from './client.js';
import {
  ChangeContractRepository,
  ContractVersionConflictError,
  ImmutableContractVersionError,
  changeContractVersionId,
} from './repositories/change-contract-repository.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const directory = dirs.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

function tempDb(): SqliteDb {
  const directory = mkdtempSync(join(tmpdir(), 'roleflock-contract-db-'));
  dirs.push(directory);
  return openMigratedDatabase(join(directory, 'test.db'));
}

function contractInput(status: UnhashedChangeContract['status'] = 'draft'): UnhashedChangeContract {
  const authorised = ['authorised', 'superseded', 'withdrawn'].includes(status);
  return {
    id: 'contract_1',
    taskId: 'task_1',
    projectId: 'project_1',
    repositoryId: 'repository_1',
    version: 1,
    status,
    objective: 'Make checkout idempotent.',
    acceptanceCriteria: [
      {
        id: 'AC-1',
        statement: 'A repeated request creates one order.',
        verificationType: 'automated_test',
        requiredEvidenceIds: ['E-1'],
      },
    ],
    prohibitedOutcomes: [],
    outOfScope: ['Payment provider migration'],
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
        locator: 'request://task_1',
        digest: 'a'.repeat(64),
      },
    ],
    unresolvedQuestions: [],
    draftedBy: 'planner_1',
    authorisedBy: authorised ? 'user_1' : undefined,
    authorisedAt: authorised ? '2026-07-28T08:00:00.000Z' : undefined,
    createdAt: '2026-07-28T07:00:00.000Z',
  };
}

describe('ChangeContractRepository', () => {
  it('persists a hash-verified first version and aggregate projection', () => {
    const repository = new ChangeContractRepository(tempDb());
    const contract = sealChangeContract(contractInput());

    const aggregate = repository.create(contract);

    expect(aggregate).toMatchObject({
      id: contract.id,
      currentContractVersion: 1,
      currentVersionId: 'contract_1:v1',
      currentHash: contract.hash,
      revision: 1,
    });
    expect(repository.getByTask('task_1')?.id).toBe(contract.id);
    expect(repository.getCurrent(contract.id)?.contract).toEqual(contract);
  });

  it('uses optimistic revision checks when replacing an editable version', () => {
    const repository = new ChangeContractRepository(tempDb());
    repository.create(sealChangeContract(contractInput()));

    const changedInput = contractInput('needs_clarification');
    changedInput.objective = 'Make checkout idempotent without changing payment semantics.';
    const aggregate = repository.replaceEditable(
      sealChangeContract(changedInput),
      1,
      '2026-07-28T07:10:00.000Z',
    );

    expect(aggregate.revision).toBe(2);
    expect(repository.getCurrent('contract_1')?.contract.objective).toContain('without changing');
    expect(() =>
      repository.replaceEditable(sealChangeContract(changedInput), 1, '2026-07-28T07:11:00.000Z'),
    ).toThrow(ContractVersionConflictError);
  });

  it('makes an authorised version immutable through both repository and SQL', () => {
    const db = tempDb();
    const repository = new ChangeContractRepository(db);
    const authorised = sealChangeContract(contractInput('authorised'));
    repository.create(authorised);

    expect(() => repository.replaceEditable(authorised, 1, '2026-07-28T08:01:00.000Z')).toThrow(
      ImmutableContractVersionError,
    );
    expect(() =>
      db
        .prepare(`UPDATE change_contract_versions SET contract_json = '{}' WHERE version_id = ?`)
        .run('contract_1:v1'),
    ).toThrow(/terminal change contract version is immutable/);
    expect(() =>
      db.prepare('DELETE FROM change_contract_versions WHERE version_id = ?').run('contract_1:v1'),
    ).toThrow(/terminal change contract version is immutable/);
  });

  it('seals awaiting state only through the dedicated authorisation operation', () => {
    const repository = new ChangeContractRepository(tempDb());
    repository.create(sealChangeContract(contractInput()));
    repository.replaceEditable(
      sealChangeContract(contractInput('awaiting_authorisation')),
      1,
      '2026-07-28T07:30:00.000Z',
    );

    const authorised = sealChangeContract(contractInput('authorised'));
    expect(() => repository.replaceEditable(authorised, 2, '2026-07-28T08:00:00.000Z')).toThrow(
      ImmutableContractVersionError,
    );

    const aggregate = repository.authorisePending(authorised, 2, '2026-07-28T08:00:00.000Z');
    expect(aggregate).toMatchObject({ status: 'authorised', revision: 3 });
    expect(repository.getCurrent('contract_1')?.contract).toEqual(authorised);
  });

  it('appends a linked revision without changing prior history', () => {
    const repository = new ChangeContractRepository(tempDb());
    const first = sealChangeContract(contractInput('authorised'));
    repository.create(first);

    const secondInput = contractInput('draft');
    secondInput.version = 2;
    secondInput.parentVersionId = changeContractVersionId(first.id, 1);
    secondInput.changeReason = 'Clarify the expected duplicate response.';
    secondInput.objective = 'Make checkout idempotent and replay the first response.';
    const second = sealChangeContract(secondInput);

    const aggregate = repository.appendVersion(second, 1, '2026-07-28T09:00:00.000Z');

    expect(aggregate).toMatchObject({ currentContractVersion: 2, revision: 2, status: 'draft' });
    expect(repository.listVersions(first.id).map((version) => version.contract)).toEqual([
      first,
      second,
    ]);
  });

  it('rejects invalid parent links and duplicate aggregate versions', () => {
    const repository = new ChangeContractRepository(tempDb());
    const first = sealChangeContract(contractInput('authorised'));
    repository.create(first);

    const secondInput = contractInput();
    secondInput.version = 2;
    secondInput.parentVersionId = 'wrong:v1';
    secondInput.changeReason = 'Revision';

    expect(() =>
      repository.appendVersion(sealChangeContract(secondInput), 1, '2026-07-28T09:00:00.000Z'),
    ).toThrow(/Expected parentVersionId/);
    expect(() => repository.create(first)).toThrow();
  });
});

import { FakeClock } from '@roleflock/contracts';
import { describe, expect, it } from 'vitest';
import {
  ChangeContractService,
  createContractAuthorisationFingerprint,
  type ChangeContractDomainEvent,
  type ChangeContractStore,
  type ContractAggregateRecord,
  type StoredContractRecord,
} from './service.js';
import type { ChangeContract, UnhashedChangeContract } from './index.js';

class MemoryStore implements ChangeContractStore {
  aggregate?: ContractAggregateRecord;
  versions: StoredContractRecord[] = [];
  events: ChangeContractDomainEvent[] = [];

  create(contract: ChangeContract, event?: ChangeContractDomainEvent): ContractAggregateRecord {
    if (this.aggregate !== undefined) throw new Error('duplicate');
    this.versions = [{ versionId: versionId(contract), contract }];
    this.aggregate = aggregateFor(contract, 1);
    if (event !== undefined) this.events.push(event);
    return this.aggregate;
  }

  replaceEditable(
    contract: ChangeContract,
    expectedRevision: number,
    _updatedAt: string,
    event?: ChangeContractDomainEvent,
  ): ContractAggregateRecord {
    this.expectRevision(expectedRevision);
    const current = this.versions.at(-1);
    if (current === undefined) throw new Error('missing');
    this.versions[this.versions.length - 1] = { ...current, contract };
    this.aggregate = aggregateFor(contract, expectedRevision + 1);
    if (event !== undefined) this.events.push(event);
    return this.aggregate;
  }

  authorisePending(
    contract: ChangeContract,
    expectedRevision: number,
    updatedAt: string,
    event?: ChangeContractDomainEvent,
  ): ContractAggregateRecord {
    return this.replaceEditable(contract, expectedRevision, updatedAt, event);
  }

  appendVersion(
    contract: ChangeContract,
    expectedRevision: number,
    _updatedAt: string,
    event?: ChangeContractDomainEvent,
  ): ContractAggregateRecord {
    this.expectRevision(expectedRevision);
    this.versions.push({ versionId: versionId(contract), contract });
    this.aggregate = aggregateFor(contract, expectedRevision + 1);
    if (event !== undefined) this.events.push(event);
    return this.aggregate;
  }

  getAggregate(contractId: string): ContractAggregateRecord | undefined {
    return this.aggregate?.id === contractId ? this.aggregate : undefined;
  }

  getCurrent(contractId: string): StoredContractRecord | undefined {
    return this.aggregate?.id === contractId ? this.versions.at(-1) : undefined;
  }

  private expectRevision(expected: number): void {
    if (this.aggregate?.revision !== expected) throw new Error('revision conflict');
  }
}

function aggregateFor(contract: ChangeContract, revision: number): ContractAggregateRecord {
  return {
    id: contract.id,
    taskId: contract.taskId,
    currentContractVersion: contract.version,
    currentVersionId: versionId(contract),
    currentHash: contract.hash,
    status: contract.status,
    revision,
  };
}

function versionId(contract: ChangeContract): string {
  return `${contract.id}:v${contract.version}`;
}

function draft(): UnhashedChangeContract {
  return {
    id: 'contract_1',
    taskId: 'task_1',
    projectId: 'project_1',
    repositoryId: 'repository_1',
    version: 1,
    status: 'draft',
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
        locator: 'request://task_1',
        digest: 'a'.repeat(64),
      },
    ],
    unresolvedQuestions: [],
    draftedBy: 'planner_1',
    createdAt: '2026-07-28T07:00:00.000Z',
  };
}

function fixture(): {
  service: ChangeContractService;
  store: MemoryStore;
  clock: FakeClock;
} {
  const store = new MemoryStore();
  const clock = new FakeClock(new Date('2026-07-28T08:00:00.000Z'));
  return { service: new ChangeContractService(store, clock), store, clock };
}

describe('ChangeContractService', () => {
  it('creates and updates only an actor-owned draft with ordered events', () => {
    const { service, store } = fixture();
    const created = service.createDraft(draft(), { actorId: 'planner_1' });
    const update = draft();
    update.objective = 'Make checkout requests idempotent.';
    const updated = service.updateDraft(update, created.aggregate.revision, {
      actorId: 'planner_1',
    });

    expect(updated.aggregate.revision).toBe(2);
    expect(store.events.map((event) => [event.sequence, event.eventType])).toEqual([
      [1, 'change_contract.draft_created'],
      [2, 'change_contract.draft_updated'],
    ]);
  });

  it('records clarification questions and prevents authorisation while blocking remains open', () => {
    const { service } = fixture();
    service.createDraft(draft(), { actorId: 'planner_1' });
    const clarification = service.requestClarification(
      'contract_1',
      [
        {
          id: 'Q-1',
          question: 'Which response should be replayed?',
          blocking: true,
          status: 'open',
        },
      ],
      1,
      { actorId: 'planner_1' },
    );
    const awaiting = service.requestAuthorisation('contract_1', clarification.aggregate.revision, {
      actorId: 'planner_1',
    });

    expect(awaiting.event.payload.blockingQuestionIds).toEqual(['Q-1']);
    expect(() =>
      service.authorise('contract_1', awaiting.aggregate.revision, {
        actorId: 'authority_1',
      }),
    ).toThrow(/Blocking question remains open/);
  });

  it('authorises only an awaiting version and emits a reproducible authority fingerprint', () => {
    const { service, store } = fixture();
    service.createDraft(draft(), { actorId: 'planner_1' });
    const awaiting = service.requestAuthorisation('contract_1', 1, {
      actorId: 'planner_1',
    });
    const authorised = service.authorise('contract_1', awaiting.aggregate.revision, {
      actorId: 'authority_1',
    });

    const payload = authorised.event.payload;
    expect(authorised.contract).toMatchObject({
      status: 'authorised',
      authorisedBy: 'authority_1',
      authorisedAt: '2026-07-28T08:00:00.000Z',
    });
    expect(payload.authorisationFingerprint).toBe(
      createContractAuthorisationFingerprint({
        contractId: 'contract_1',
        contractVersion: 1,
        awaitingHash: String(payload.awaitingHash),
        authorisedHash: authorised.contract.hash,
        authorisedBy: 'authority_1',
        authorisedAt: '2026-07-28T08:00:00.000Z',
      }),
    );
    expect(store.events.at(-1)?.sequence).toBe(3);
  });

  it('creates a linked draft revision without modifying the authorised version', () => {
    const { service, store, clock } = fixture();
    service.createDraft(draft(), { actorId: 'planner_1' });
    service.requestAuthorisation('contract_1', 1, { actorId: 'planner_1' });
    const authorised = service.authorise('contract_1', 2, {
      actorId: 'authority_1',
    });
    clock.advance(60_000);

    const revised = service.revise(
      'contract_1',
      {
        objective: 'Make checkout idempotent and replay the original response.',
        changeReason: 'Clarify response replay.',
      },
      authorised.aggregate.revision,
      { actorId: 'planner_2' },
    );

    expect(revised.contract).toMatchObject({
      version: 2,
      parentVersionId: 'contract_1:v1',
      status: 'draft',
      draftedBy: 'planner_2',
      changeReason: 'Clarify response replay.',
    });
    expect(store.versions).toHaveLength(2);
    expect(store.versions[0]?.contract).toEqual(authorised.contract);
  });

  it('rejects invalid lifecycle entry points', () => {
    const { service } = fixture();
    expect(() =>
      service.createDraft(
        { ...draft(), status: 'awaiting_authorisation' },
        {
          actorId: 'planner_1',
        },
      ),
    ).toThrow(/created as draft/);
    service.createDraft(draft(), { actorId: 'planner_1' });
    expect(() => service.authorise('contract_1', 1, { actorId: 'authority_1' })).toThrow(
      /Cannot authorise/,
    );
    expect(() =>
      service.revise('contract_1', { changeReason: 'Not yet authorised.' }, 1, {
        actorId: 'planner_1',
      }),
    ).toThrow(/Only an authorised/);
  });

  it('does not let an edit move a contract to another authority scope', () => {
    const { service } = fixture();
    service.createDraft(draft(), { actorId: 'planner_1' });
    const moved = draft();
    moved.repositoryId = 'repository_attacker';

    expect(() => service.updateDraft(moved, 1, { actorId: 'planner_1' })).toThrow(
      /cannot change task, project, or repository identity/,
    );
  });
});

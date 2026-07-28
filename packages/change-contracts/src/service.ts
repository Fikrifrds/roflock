import { createId, sha256Canonical, type Clock, type EventEnvelope } from '@roleflock/contracts';
import {
  sealChangeContract,
  type ChangeContract,
  type ContractQuestion,
  type UnhashedChangeContract,
} from './index.js';

export type ChangeContractEventType =
  | 'change_contract.draft_created'
  | 'change_contract.draft_updated'
  | 'change_contract.clarification_requested'
  | 'change_contract.authorisation_requested'
  | 'change_contract.authorised'
  | 'change_contract.revision_created';

export interface ChangeContractDomainEvent extends EventEnvelope {
  aggregateType: 'change_contract';
  eventType: ChangeContractEventType;
}

export interface ContractAggregateRecord {
  id: string;
  taskId: string;
  currentContractVersion: number;
  currentVersionId: string;
  currentHash: string;
  status: ChangeContract['status'];
  revision: number;
}

export interface StoredContractRecord {
  versionId: string;
  contract: ChangeContract;
}

export interface ChangeContractStore {
  create(contract: ChangeContract, event?: ChangeContractDomainEvent): ContractAggregateRecord;
  replaceEditable(
    contract: ChangeContract,
    expectedRevision: number,
    updatedAt: string,
    event?: ChangeContractDomainEvent,
  ): ContractAggregateRecord;
  authorisePending(
    contract: ChangeContract,
    expectedRevision: number,
    updatedAt: string,
    event?: ChangeContractDomainEvent,
  ): ContractAggregateRecord;
  appendVersion(
    contract: ChangeContract,
    expectedRevision: number,
    updatedAt: string,
    event?: ChangeContractDomainEvent,
  ): ContractAggregateRecord;
  getAggregate(contractId: string): ContractAggregateRecord | undefined;
  getCurrent(contractId: string): StoredContractRecord | undefined;
}

export interface ContractCommandMetadata {
  actorId: string;
  idempotencyKey?: string;
  correlationId?: string;
  causationId?: string;
}

export interface ContractCommandResult {
  aggregate: ContractAggregateRecord;
  contract: ChangeContract;
  event: ChangeContractDomainEvent;
}

export interface ReviseContractInput {
  objective?: string;
  acceptanceCriteria?: UnhashedChangeContract['acceptanceCriteria'];
  prohibitedOutcomes?: UnhashedChangeContract['prohibitedOutcomes'];
  outOfScope?: string[];
  risk?: UnhashedChangeContract['risk'];
  requiredEvidence?: UnhashedChangeContract['requiredEvidence'];
  authoritySources?: UnhashedChangeContract['authoritySources'];
  unresolvedQuestions?: ContractQuestion[];
  changeReason: string;
}

export interface ContractAuthorisationFingerprintInput {
  contractId: string;
  contractVersion: number;
  awaitingHash: string;
  authorisedHash: string;
  authorisedBy: string;
  authorisedAt: string;
}

export function createContractAuthorisationFingerprint(
  input: ContractAuthorisationFingerprintInput,
): string {
  return sha256Canonical({
    kind: 'roleflock.change_contract.authorisation',
    schemaVersion: 1,
    ...input,
  });
}

export class ChangeContractService {
  constructor(
    private readonly store: ChangeContractStore,
    private readonly clock: Clock,
  ) {}

  createDraft(
    input: UnhashedChangeContract,
    metadata: ContractCommandMetadata,
  ): ContractCommandResult {
    if (input.status !== 'draft' || input.version !== 1) {
      throw new Error('A Change Contract must be created as draft version 1');
    }
    if (input.draftedBy !== metadata.actorId) {
      throw new Error('Draft actor must match draftedBy');
    }

    const contract = sealChangeContract(input);
    const event = this.event(contract, 1, 'change_contract.draft_created', metadata, {
      version: contract.version,
      hash: contract.hash,
      taskId: contract.taskId,
    });
    const aggregate = this.store.create(contract, event);
    return { aggregate, contract, event };
  }

  updateDraft(
    input: UnhashedChangeContract,
    expectedRevision: number,
    metadata: ContractCommandMetadata,
  ): ContractCommandResult {
    const current = this.current(input.id);
    if (input.version !== current.contract.version) {
      throw new Error('Draft update must target the current Change Contract version');
    }
    if (
      input.taskId !== current.contract.taskId ||
      input.projectId !== current.contract.projectId ||
      input.repositoryId !== current.contract.repositoryId
    ) {
      throw new Error('Draft update cannot change task, project, or repository identity');
    }
    if (input.status !== 'draft' && input.status !== 'needs_clarification') {
      throw new Error('Draft update cannot create authorisation or terminal state');
    }

    const contract = sealChangeContract(input);
    const event = this.event(
      contract,
      expectedRevision + 1,
      'change_contract.draft_updated',
      metadata,
      {
        version: contract.version,
        previousHash: current.contract.hash,
        hash: contract.hash,
      },
    );
    const aggregate = this.store.replaceEditable(
      contract,
      expectedRevision,
      this.clock.nowIso(),
      event,
    );
    return { aggregate, contract, event };
  }

  requestClarification(
    contractId: string,
    questions: ContractQuestion[],
    expectedRevision: number,
    metadata: ContractCommandMetadata,
  ): ContractCommandResult {
    if (questions.length === 0) {
      throw new Error('Clarification requires at least one question');
    }
    const current = this.current(contractId);
    const contract = sealChangeContract({
      ...withoutHash(current.contract),
      status: 'needs_clarification',
      unresolvedQuestions: questions,
    });
    const event = this.event(
      contract,
      expectedRevision + 1,
      'change_contract.clarification_requested',
      metadata,
      {
        version: contract.version,
        previousHash: current.contract.hash,
        hash: contract.hash,
        questionIds: questions.map((question) => question.id),
      },
    );
    const aggregate = this.store.replaceEditable(
      contract,
      expectedRevision,
      this.clock.nowIso(),
      event,
    );
    return { aggregate, contract, event };
  }

  requestAuthorisation(
    contractId: string,
    expectedRevision: number,
    metadata: ContractCommandMetadata,
  ): ContractCommandResult {
    const current = this.current(contractId);
    if (current.contract.status !== 'draft' && current.contract.status !== 'needs_clarification') {
      throw new Error(`Cannot request authorisation from ${current.contract.status}`);
    }

    const contract = sealChangeContract({
      ...withoutHash(current.contract),
      status: 'awaiting_authorisation',
    });
    const event = this.event(
      contract,
      expectedRevision + 1,
      'change_contract.authorisation_requested',
      metadata,
      {
        version: contract.version,
        previousHash: current.contract.hash,
        hash: contract.hash,
        blockingQuestionIds: contract.unresolvedQuestions
          .filter((question) => question.blocking && question.status === 'open')
          .map((question) => question.id),
      },
    );
    const aggregate = this.store.replaceEditable(
      contract,
      expectedRevision,
      this.clock.nowIso(),
      event,
    );
    return { aggregate, contract, event };
  }

  authorise(
    contractId: string,
    expectedRevision: number,
    metadata: ContractCommandMetadata,
  ): ContractCommandResult {
    const current = this.current(contractId);
    if (current.contract.status !== 'awaiting_authorisation') {
      throw new Error(`Cannot authorise Change Contract from ${current.contract.status}`);
    }

    const authorisedAt = this.clock.nowIso();
    const contract = sealChangeContract({
      ...withoutHash(current.contract),
      status: 'authorised',
      authorisedBy: metadata.actorId,
      authorisedAt,
    });
    const authorisationFingerprint = createContractAuthorisationFingerprint({
      contractId,
      contractVersion: contract.version,
      awaitingHash: current.contract.hash,
      authorisedHash: contract.hash,
      authorisedBy: metadata.actorId,
      authorisedAt,
    });
    const event = this.event(
      contract,
      expectedRevision + 1,
      'change_contract.authorised',
      metadata,
      {
        version: contract.version,
        awaitingHash: current.contract.hash,
        authorisedHash: contract.hash,
        authorisedBy: metadata.actorId,
        authorisedAt,
        authorisationFingerprint,
      },
    );
    const aggregate = this.store.authorisePending(contract, expectedRevision, authorisedAt, event);
    return { aggregate, contract, event };
  }

  revise(
    contractId: string,
    input: ReviseContractInput,
    expectedRevision: number,
    metadata: ContractCommandMetadata,
  ): ContractCommandResult {
    const current = this.current(contractId);
    if (current.contract.status !== 'authorised') {
      throw new Error('Only an authorised Change Contract may be revised');
    }

    const contract = sealChangeContract({
      ...withoutHash(current.contract),
      ...input,
      id: current.contract.id,
      taskId: current.contract.taskId,
      projectId: current.contract.projectId,
      repositoryId: current.contract.repositoryId,
      version: current.contract.version + 1,
      parentVersionId: current.versionId,
      changeReason: input.changeReason,
      status: 'draft',
      draftedBy: metadata.actorId,
      authorisedBy: undefined,
      authorisedAt: undefined,
      createdAt: this.clock.nowIso(),
    });
    const event = this.event(
      contract,
      expectedRevision + 1,
      'change_contract.revision_created',
      metadata,
      {
        version: contract.version,
        parentVersionId: current.versionId,
        parentHash: current.contract.hash,
        hash: contract.hash,
        changeReason: input.changeReason,
      },
    );
    const aggregate = this.store.appendVersion(
      contract,
      expectedRevision,
      contract.createdAt,
      event,
    );
    return { aggregate, contract, event };
  }

  private current(contractId: string): StoredContractRecord {
    const current = this.store.getCurrent(contractId);
    if (current === undefined) {
      throw new Error(`Change Contract ${contractId} does not exist`);
    }
    return current;
  }

  private event(
    contract: ChangeContract,
    sequence: number,
    eventType: ChangeContractEventType,
    metadata: ContractCommandMetadata,
    payload: Record<string, unknown>,
  ): ChangeContractDomainEvent {
    return {
      id: createId('evt'),
      aggregateType: 'change_contract',
      aggregateId: contract.id,
      sequence,
      eventType,
      payload,
      metadata: {
        schemaVersion: 1,
        actorId: metadata.actorId,
        idempotencyKey: metadata.idempotencyKey,
        correlationId: metadata.correlationId,
        causationId: metadata.causationId,
      },
      createdAt: this.clock.nowIso(),
    };
  }
}

function withoutHash(contract: ChangeContract): UnhashedChangeContract {
  const { hash: _hash, hashAlgorithm: _hashAlgorithm, ...unhashed } = contract;
  return unhashed;
}

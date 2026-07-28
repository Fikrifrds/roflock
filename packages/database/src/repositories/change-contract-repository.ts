import {
  parseVerifiedChangeContract,
  type ChangeContract,
  type ChangeContractDomainEvent,
} from '@roleflock/change-contracts';
import type { SqliteDb } from '../client.js';

export interface ChangeContractAggregate {
  id: string;
  taskId: string;
  projectId: string;
  repositoryId: string;
  currentContractVersion: number;
  currentVersionId: string;
  currentHash: string;
  status: ChangeContract['status'];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredChangeContractVersion {
  versionId: string;
  contract: ChangeContract;
}

export class ContractVersionConflictError extends Error {
  constructor(
    readonly contractId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number | undefined,
  ) {
    super(
      `Change Contract revision conflict for ${contractId}: expected ${expectedRevision}, actual ${
        actualRevision ?? 'missing'
      }`,
    );
    this.name = 'ContractVersionConflictError';
  }
}

export class ImmutableContractVersionError extends Error {
  constructor(readonly versionId: string) {
    super(`Change Contract version ${versionId} is immutable`);
    this.name = 'ImmutableContractVersionError';
  }
}

export function changeContractVersionId(contractId: string, version: number): string {
  return `${contractId}:v${version}`;
}

export class ChangeContractRepository {
  constructor(private readonly db: SqliteDb) {}

  create(
    contractInput: ChangeContract,
    event?: ChangeContractDomainEvent,
  ): ChangeContractAggregate {
    const contract = parseVerifiedChangeContract(contractInput);
    if (contract.version !== 1 || contract.parentVersionId !== undefined) {
      throw new Error('A new Change Contract aggregate must start at version 1 without a parent');
    }

    const versionId = changeContractVersionId(contract.id, contract.version);
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO change_contracts
            (id, task_id, project_id, repository_id, current_contract_version, current_version_id,
             current_hash, status, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          contract.id,
          contract.taskId,
          contract.projectId,
          contract.repositoryId,
          contract.version,
          versionId,
          contract.hash,
          contract.status,
          contract.createdAt,
          contract.createdAt,
        );
      this.insertVersion(versionId, contract);
      if (event !== undefined) this.insertEvent(event);
    });
    transaction();
    return this.getAggregateOrThrow(contract.id);
  }

  /**
   * Replaces only the current editable version. The compare-and-swap revision
   * protects planner and authority clients from overwriting newer decisions.
   */
  replaceEditable(
    contractInput: ChangeContract,
    expectedRevision: number,
    updatedAt: string,
    event?: ChangeContractDomainEvent,
  ): ChangeContractAggregate {
    const contract = parseVerifiedChangeContract(contractInput);
    const aggregate = this.getAggregateOrThrow(contract.id);
    this.assertExpectedRevision(aggregate, expectedRevision);

    if (contract.version !== aggregate.currentContractVersion) {
      throw new Error(
        `Cannot replace Change Contract version ${contract.version}; current version is ${aggregate.currentContractVersion}`,
      );
    }

    const stored = this.getVersionOrThrow(contract.id, contract.version);
    if (!isContentEditable(stored.contract.status)) {
      throw new ImmutableContractVersionError(stored.versionId);
    }
    if (!isNonTerminal(contract.status)) {
      throw new Error(
        'replaceEditable cannot create a terminal version; use authorisePending for authorisation',
      );
    }

    const transaction = this.db.transaction(() => {
      this.replaceCurrentVersion(contract, stored.versionId, expectedRevision, updatedAt);
      if (event !== undefined) this.insertEvent(event);
    });
    transaction();
    return this.getAggregateOrThrow(contract.id);
  }

  /**
   * The sole repository path that may seal an awaiting-authorisation row. It
   * keeps general draft editing incapable of manufacturing authorised state.
   */
  authorisePending(
    contractInput: ChangeContract,
    expectedRevision: number,
    updatedAt: string,
    event?: ChangeContractDomainEvent,
  ): ChangeContractAggregate {
    const contract = parseVerifiedChangeContract(contractInput);
    const aggregate = this.getAggregateOrThrow(contract.id);
    this.assertExpectedRevision(aggregate, expectedRevision);
    const stored = this.getVersionOrThrow(contract.id, contract.version);

    if (
      contract.version !== aggregate.currentContractVersion ||
      stored.contract.status !== 'awaiting_authorisation' ||
      contract.status !== 'authorised'
    ) {
      throw new Error(
        'authorisePending requires the current awaiting_authorisation version and an authorised replacement',
      );
    }

    const transaction = this.db.transaction(() => {
      this.replaceCurrentVersion(contract, stored.versionId, expectedRevision, updatedAt);
      if (event !== undefined) this.insertEvent(event);
    });
    transaction();
    return this.getAggregateOrThrow(contract.id);
  }

  appendVersion(
    contractInput: ChangeContract,
    expectedRevision: number,
    updatedAt: string,
    event?: ChangeContractDomainEvent,
  ): ChangeContractAggregate {
    const contract = parseVerifiedChangeContract(contractInput);
    const aggregate = this.getAggregateOrThrow(contract.id);
    this.assertExpectedRevision(aggregate, expectedRevision);

    const expectedVersion = aggregate.currentContractVersion + 1;
    if (contract.version !== expectedVersion) {
      throw new Error(
        `Expected Change Contract version ${expectedVersion}, got ${contract.version}`,
      );
    }
    if (contract.parentVersionId !== aggregate.currentVersionId) {
      throw new Error(
        `Expected parentVersionId ${aggregate.currentVersionId}, got ${
          contract.parentVersionId ?? 'missing'
        }`,
      );
    }

    const versionId = changeContractVersionId(contract.id, contract.version);
    const transaction = this.db.transaction(() => {
      this.compareAndSwapAggregate(contract, expectedRevision, updatedAt);
      this.insertVersion(versionId, contract);
      if (event !== undefined) this.insertEvent(event);
    });
    transaction();
    return this.getAggregateOrThrow(contract.id);
  }

  getAggregate(contractId: string): ChangeContractAggregate | undefined {
    const row = this.db.prepare('SELECT * FROM change_contracts WHERE id = ?').get(contractId) as
      Record<string, unknown> | undefined;
    return row === undefined ? undefined : mapAggregate(row);
  }

  getByTask(taskId: string): ChangeContractAggregate | undefined {
    const row = this.db.prepare('SELECT * FROM change_contracts WHERE task_id = ?').get(taskId) as
      Record<string, unknown> | undefined;
    return row === undefined ? undefined : mapAggregate(row);
  }

  getCurrent(contractId: string): StoredChangeContractVersion | undefined {
    const aggregate = this.getAggregate(contractId);
    if (aggregate === undefined) return undefined;
    return this.getVersion(contractId, aggregate.currentContractVersion);
  }

  getVersion(contractId: string, version: number): StoredChangeContractVersion | undefined {
    const row = this.db
      .prepare(
        `SELECT version_id, contract_json
         FROM change_contract_versions
         WHERE contract_id = ? AND version = ?`,
      )
      .get(contractId, version) as { version_id: string; contract_json: string } | undefined;
    return row === undefined ? undefined : mapVersion(row);
  }

  listVersions(contractId: string): StoredChangeContractVersion[] {
    const rows = this.db
      .prepare(
        `SELECT version_id, contract_json
         FROM change_contract_versions
         WHERE contract_id = ?
         ORDER BY version ASC`,
      )
      .all(contractId) as Array<{ version_id: string; contract_json: string }>;
    return rows.map(mapVersion);
  }

  private compareAndSwapAggregate(
    contract: ChangeContract,
    expectedRevision: number,
    updatedAt: string,
  ): void {
    const versionId = changeContractVersionId(contract.id, contract.version);
    const result = this.db
      .prepare(
        `UPDATE change_contracts
         SET current_contract_version = ?, current_version_id = ?, current_hash = ?,
             status = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .run(
        contract.version,
        versionId,
        contract.hash,
        contract.status,
        updatedAt,
        contract.id,
        expectedRevision,
      );
    if (result.changes !== 1) {
      throw new ContractVersionConflictError(
        contract.id,
        expectedRevision,
        this.getAggregate(contract.id)?.revision,
      );
    }
  }

  private insertVersion(versionId: string, contract: ChangeContract): void {
    this.db
      .prepare(
        `INSERT INTO change_contract_versions
          (version_id, contract_id, version, parent_version_id, status, hash, contract_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        versionId,
        contract.id,
        contract.version,
        contract.parentVersionId ?? null,
        contract.status,
        contract.hash,
        JSON.stringify(contract),
        contract.createdAt,
      );
  }

  private insertEvent(event: ChangeContractDomainEvent): void {
    this.db
      .prepare(
        `INSERT INTO events
          (id, aggregate_type, aggregate_id, sequence, event_type, payload_json, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.aggregateType,
        event.aggregateId,
        event.sequence,
        event.eventType,
        JSON.stringify(event.payload),
        JSON.stringify(event.metadata),
        event.createdAt,
      );
  }

  private replaceCurrentVersion(
    contract: ChangeContract,
    versionId: string,
    expectedRevision: number,
    updatedAt: string,
  ): void {
    this.compareAndSwapAggregate(contract, expectedRevision, updatedAt);
    this.db
      .prepare(
        `UPDATE change_contract_versions
         SET parent_version_id = ?, status = ?, hash = ?, contract_json = ?, created_at = ?
         WHERE version_id = ?`,
      )
      .run(
        contract.parentVersionId ?? null,
        contract.status,
        contract.hash,
        JSON.stringify(contract),
        contract.createdAt,
        versionId,
      );
  }

  private assertExpectedRevision(
    aggregate: ChangeContractAggregate,
    expectedRevision: number,
  ): void {
    if (aggregate.revision !== expectedRevision) {
      throw new ContractVersionConflictError(aggregate.id, expectedRevision, aggregate.revision);
    }
  }

  private getAggregateOrThrow(contractId: string): ChangeContractAggregate {
    const aggregate = this.getAggregate(contractId);
    if (aggregate === undefined) {
      throw new ContractVersionConflictError(contractId, 0, undefined);
    }
    return aggregate;
  }

  private getVersionOrThrow(contractId: string, version: number): StoredChangeContractVersion {
    const stored = this.getVersion(contractId, version);
    if (stored === undefined) {
      throw new Error(`Change Contract ${contractId} version ${version} does not exist`);
    }
    return stored;
  }
}

function isContentEditable(status: ChangeContract['status']): boolean {
  return status === 'draft' || status === 'needs_clarification';
}

function isNonTerminal(status: ChangeContract['status']): boolean {
  return (
    status === 'draft' || status === 'needs_clarification' || status === 'awaiting_authorisation'
  );
}

function mapAggregate(row: Record<string, unknown>): ChangeContractAggregate {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    projectId: String(row.project_id),
    repositoryId: String(row.repository_id),
    currentContractVersion: Number(row.current_contract_version),
    currentVersionId: String(row.current_version_id),
    currentHash: String(row.current_hash),
    status: String(row.status) as ChangeContract['status'],
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapVersion(row: {
  version_id: string;
  contract_json: string;
}): StoredChangeContractVersion {
  return {
    versionId: row.version_id,
    contract: parseVerifiedChangeContract(JSON.parse(row.contract_json) as unknown),
  };
}

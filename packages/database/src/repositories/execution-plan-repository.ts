import {
  ExecutionPlanSchema,
  PlanDeviationSchema,
  sealExecutionPlan,
  verifyExecutionPlanHash,
  verifyPlanDeviationHash,
  type ActorReference,
  type ExecutionPlan,
  type PlanDeviation,
} from '@roleflock/change-contracts';
import type { SqliteDb } from '../client.js';

export type ExecutionPlanAggregate = {
  id: string;
  taskId: string;
  contractId: string;
  currentVersion: number;
  currentSnapshotId: string;
  currentHash: string;
  status: ExecutionPlan['status'];
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export class ExecutionPlanRepository {
  constructor(private readonly db: SqliteDb) {}

  create(plan: ExecutionPlan): ExecutionPlanAggregate {
    ExecutionPlanSchema.parse(plan);
    if (!verifyExecutionPlanHash(plan)) throw new Error('Execution Plan hash is invalid');
    if (plan.status !== 'proposed') throw new Error('A new Execution Plan must be proposed');
    const createdAt = new Date().toISOString();
    const snapshotId = planSnapshotId(plan);
    const tx = this.db.transaction(() => {
      this.insertSnapshot(snapshotId, plan, createdAt);
      this.db
        .prepare(
          `INSERT INTO execution_plan_aggregates (
             id, task_id, contract_id, current_version, current_snapshot_id,
             current_hash, status, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          plan.id,
          plan.taskId,
          plan.contractId,
          plan.version,
          snapshotId,
          plan.hash,
          plan.status,
          createdAt,
          createdAt,
        );
    });
    tx();
    return this.getAggregate(plan.id)!;
  }

  approve(
    planId: string,
    expectedRevision: number,
    reviewedBy: ActorReference,
    approvedAt: string,
  ): { aggregate: ExecutionPlanAggregate; plan: ExecutionPlan } {
    const current = this.requireCurrent(planId, expectedRevision);
    if (current.plan.status !== 'proposed') throw new Error('Only a proposed plan can be approved');
    const { hash: _hash, hashAlgorithm: _algorithm, ...unhashed } = current.plan;
    const approved = sealExecutionPlan({
      ...unhashed,
      status: 'approved',
      reviewedBy,
      approvedAt,
    });
    return this.advance(current.aggregate, approved, approvedAt);
  }

  revise(
    planId: string,
    expectedRevision: number,
    proposal: ExecutionPlan,
  ): { aggregate: ExecutionPlanAggregate; plan: ExecutionPlan } {
    const current = this.requireCurrent(planId, expectedRevision);
    if (proposal.id !== planId || proposal.version !== current.plan.version + 1) {
      throw new Error('Plan revision identity or version is invalid');
    }
    if (
      proposal.parentPlanId !== planSnapshotId(current.plan) ||
      proposal.revisionReason === undefined
    ) {
      throw new Error('Plan revision must link to the exact current snapshot');
    }
    if (proposal.status !== 'proposed') throw new Error('A plan revision must be proposed');
    return this.advance(current.aggregate, proposal, new Date().toISOString());
  }

  getByTask(
    taskId: string,
  ): { aggregate: ExecutionPlanAggregate; plan: ExecutionPlan } | undefined {
    const row = this.db
      .prepare(`SELECT id FROM execution_plan_aggregates WHERE task_id = ?`)
      .get(taskId) as { id: string } | undefined;
    return row === undefined ? undefined : this.getCurrent(row.id);
  }

  getCurrent(
    planId: string,
  ): { aggregate: ExecutionPlanAggregate; plan: ExecutionPlan } | undefined {
    const aggregate = this.getAggregate(planId);
    if (aggregate === undefined) return undefined;
    const row = this.db
      .prepare(`SELECT artifact_json FROM execution_plan_snapshots WHERE snapshot_id = ?`)
      .get(aggregate.currentSnapshotId) as { artifact_json: string } | undefined;
    if (row === undefined) throw new Error(`Current plan snapshot is missing: ${planId}`);
    const plan = ExecutionPlanSchema.parse(JSON.parse(row.artifact_json));
    if (!verifyExecutionPlanHash(plan)) {
      throw new Error(`Current Execution Plan hash is invalid: ${planId}`);
    }
    return {
      aggregate,
      plan,
    };
  }

  listSnapshots(planId: string): ExecutionPlan[] {
    return (
      this.db
        .prepare(
          `SELECT artifact_json FROM execution_plan_snapshots
           WHERE plan_id = ? ORDER BY created_at ASC, rowid ASC`,
        )
        .all(planId) as Array<{ artifact_json: string }>
    ).map((row) => {
      const plan = ExecutionPlanSchema.parse(JSON.parse(row.artifact_json));
      if (!verifyExecutionPlanHash(plan)) {
        throw new Error(`Historical Execution Plan hash is invalid: ${plan.id}`);
      }
      return plan;
    });
  }

  addDeviation(taskId: string, deviation: PlanDeviation, createdAt: string): void {
    PlanDeviationSchema.parse(deviation);
    if (!verifyPlanDeviationHash(deviation)) throw new Error('Plan Deviation hash is invalid');
    const current = this.getCurrent(deviation.planId);
    if (current === undefined || current.aggregate.taskId !== taskId) {
      throw new Error('Plan Deviation does not belong to the task');
    }
    if (deviation.planHash !== current.plan.hash) {
      throw new Error('Plan Deviation must bind to the exact current plan hash');
    }
    this.db
      .prepare(
        `INSERT INTO plan_deviations (
           id, task_id, plan_id, plan_hash, status, artifact_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        deviation.id,
        taskId,
        deviation.planId,
        deviation.planHash,
        deviation.status,
        JSON.stringify(deviation),
        createdAt,
        createdAt,
      );
  }

  listDeviations(taskId: string): PlanDeviation[] {
    return (
      this.db
        .prepare(
          `SELECT artifact_json FROM plan_deviations WHERE task_id = ? ORDER BY created_at ASC`,
        )
        .all(taskId) as Array<{ artifact_json: string }>
    ).map((row) => {
      const deviation = PlanDeviationSchema.parse(JSON.parse(row.artifact_json));
      if (!verifyPlanDeviationHash(deviation)) {
        throw new Error(`Plan Deviation hash is invalid: ${deviation.id}`);
      }
      return deviation;
    });
  }

  private getAggregate(planId: string): ExecutionPlanAggregate | undefined {
    const row = this.db
      .prepare(`SELECT * FROM execution_plan_aggregates WHERE id = ?`)
      .get(planId) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : mapAggregate(row);
  }

  private requireCurrent(
    planId: string,
    expectedRevision: number,
  ): { aggregate: ExecutionPlanAggregate; plan: ExecutionPlan } {
    const current = this.getCurrent(planId);
    if (current === undefined) throw new Error(`Execution Plan not found: ${planId}`);
    if (current.aggregate.revision !== expectedRevision) {
      throw new Error(
        `Execution Plan revision conflict: expected ${expectedRevision}, actual ${current.aggregate.revision}`,
      );
    }
    return current;
  }

  private advance(
    aggregate: ExecutionPlanAggregate,
    plan: ExecutionPlan,
    timestamp: string,
  ): { aggregate: ExecutionPlanAggregate; plan: ExecutionPlan } {
    ExecutionPlanSchema.parse(plan);
    if (!verifyExecutionPlanHash(plan)) throw new Error('Execution Plan hash is invalid');
    const snapshotId = planSnapshotId(plan);
    const tx = this.db.transaction(() => {
      this.insertSnapshot(snapshotId, plan, timestamp);
      this.db
        .prepare(
          `UPDATE execution_plan_aggregates
           SET current_version = ?, current_snapshot_id = ?, current_hash = ?,
               status = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(
          plan.version,
          snapshotId,
          plan.hash,
          plan.status,
          timestamp,
          aggregate.id,
          aggregate.revision,
        );
    });
    tx();
    return { aggregate: this.getAggregate(aggregate.id)!, plan };
  }

  private insertSnapshot(snapshotId: string, plan: ExecutionPlan, createdAt: string): void {
    this.db
      .prepare(
        `INSERT INTO execution_plan_snapshots (
           snapshot_id, plan_id, version, hash, status, artifact_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshotId,
        plan.id,
        plan.version,
        plan.hash,
        plan.status,
        JSON.stringify(plan),
        createdAt,
      );
  }
}

export function planSnapshotId(plan: Pick<ExecutionPlan, 'id' | 'version' | 'hash'>): string {
  return `${plan.id}:v${plan.version}:${plan.hash}`;
}

function mapAggregate(row: Record<string, unknown>): ExecutionPlanAggregate {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    contractId: String(row.contract_id),
    currentVersion: Number(row.current_version),
    currentSnapshotId: String(row.current_snapshot_id),
    currentHash: String(row.current_hash),
    status: String(row.status) as ExecutionPlan['status'],
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

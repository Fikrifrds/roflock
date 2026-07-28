import {
  VerificationSpecificationSchema,
  verifyVerificationSpecificationHash,
  type VerificationSpecification,
} from '@roleflock/verification-runner';
import type { SqliteDb } from '../client.js';

export class VerificationSpecificationRepository {
  constructor(private readonly db: SqliteDb) {}

  create(
    specification: VerificationSpecification,
    createdAt = new Date().toISOString(),
  ): VerificationSpecification {
    VerificationSpecificationSchema.parse(specification);
    if (!verifyVerificationSpecificationHash(specification)) {
      throw new Error('Verification Specification hash is invalid');
    }
    this.db
      .prepare(
        `INSERT INTO verification_specifications (
           id, task_id, contract_hash, plan_id, plan_hash, version, hash, artifact_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        specification.id,
        specification.taskId,
        specification.contractHash,
        specification.planId,
        specification.planHash,
        specification.version,
        specification.hash,
        JSON.stringify(specification),
        createdAt,
      );
    return specification;
  }

  getByTask(taskId: string): VerificationSpecification | undefined {
    const row = this.db
      .prepare(`SELECT artifact_json FROM verification_specifications WHERE task_id = ?`)
      .get(taskId) as { artifact_json: string } | undefined;
    if (row === undefined) return undefined;
    const specification = VerificationSpecificationSchema.parse(JSON.parse(row.artifact_json));
    if (!verifyVerificationSpecificationHash(specification)) {
      throw new Error(`Stored Verification Specification hash is invalid: ${specification.id}`);
    }
    return specification;
  }

  get(id: string): VerificationSpecification | undefined {
    const row = this.db
      .prepare(`SELECT artifact_json FROM verification_specifications WHERE id = ?`)
      .get(id) as { artifact_json: string } | undefined;
    if (row === undefined) return undefined;
    const specification = VerificationSpecificationSchema.parse(JSON.parse(row.artifact_json));
    if (!verifyVerificationSpecificationHash(specification)) {
      throw new Error(`Stored Verification Specification hash is invalid: ${id}`);
    }
    return specification;
  }
}

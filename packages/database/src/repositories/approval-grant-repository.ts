import type { ApprovalGrant, ApprovalGrantScope } from '@roleflock/contracts';
import type { SqliteDb } from '../client.js';

export interface CreateApprovalGrantInput {
  id: string;
  projectId: string;
  scope: ApprovalGrantScope;
  fingerprint?: string;
  requestTypes?: string[];
  allowedPathPatterns?: string[];
  allowedCommandTemplates?: string[];
  allowedDestinations?: string[];
  maximumRisk: ApprovalGrant['maximumRisk'];
  maximumAdditionalCost?: number;
  maximumApplications?: number;
  expiresAt: string;
  createdBy: string;
  createdAt: string;
}

export class ApprovalGrantRepository {
  constructor(private readonly db: SqliteDb) {}

  create(input: CreateApprovalGrantInput): ApprovalGrant {
    this.db
      .prepare(
        `INSERT INTO approval_grants
          (id, project_id, scope, fingerprint, request_types_json,
           allowed_path_patterns_json, allowed_command_templates_json, allowed_destinations_json,
           maximum_risk, maximum_additional_cost, maximum_applications, applications_used,
           expires_at, revoked_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.scope,
        input.fingerprint ?? null,
        input.requestTypes ? JSON.stringify(input.requestTypes) : null,
        input.allowedPathPatterns ? JSON.stringify(input.allowedPathPatterns) : null,
        input.allowedCommandTemplates ? JSON.stringify(input.allowedCommandTemplates) : null,
        input.allowedDestinations ? JSON.stringify(input.allowedDestinations) : null,
        input.maximumRisk,
        input.maximumAdditionalCost ?? null,
        input.maximumApplications ?? null,
        input.expiresAt,
        input.createdBy,
        input.createdAt,
      );
    return this.get(input.id)!;
  }

  get(id: string): ApprovalGrant | undefined {
    const row = this.db.prepare(`SELECT * FROM approval_grants WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    return row ? mapGrant(row) : undefined;
  }

  listByProject(projectId: string): ApprovalGrant[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM approval_grants
         WHERE project_id = ?
         ORDER BY created_at DESC`,
      )
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map(mapGrant);
  }

  listActive(projectId: string, at = new Date().toISOString()): ApprovalGrant[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM approval_grants
         WHERE project_id = ?
           AND revoked_at IS NULL
           AND expires_at > ?
           AND (maximum_applications IS NULL OR applications_used < maximum_applications)
         ORDER BY created_at DESC`,
      )
      .all(projectId, at) as Array<Record<string, unknown>>;
    return rows.map(mapGrant);
  }

  revoke(id: string, revokedAt: string): void {
    this.db
      .prepare(`UPDATE approval_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
      .run(revokedAt, id);
  }

  incrementApplications(id: string): void {
    this.db
      .prepare(
        `UPDATE approval_grants
         SET applications_used = applications_used + 1
         WHERE id = ?`,
      )
      .run(id);
  }
}

function mapGrant(row: Record<string, unknown>): ApprovalGrant {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    scope: row.scope as ApprovalGrant['scope'],
    fingerprint: row.fingerprint ? String(row.fingerprint) : undefined,
    requestTypes: row.request_types_json
      ? (JSON.parse(String(row.request_types_json)) as string[])
      : undefined,
    allowedPathPatterns: row.allowed_path_patterns_json
      ? (JSON.parse(String(row.allowed_path_patterns_json)) as string[])
      : undefined,
    allowedCommandTemplates: row.allowed_command_templates_json
      ? (JSON.parse(String(row.allowed_command_templates_json)) as string[])
      : undefined,
    allowedDestinations: row.allowed_destinations_json
      ? (JSON.parse(String(row.allowed_destinations_json)) as string[])
      : undefined,
    maximumRisk: row.maximum_risk as ApprovalGrant['maximumRisk'],
    maximumAdditionalCost:
      row.maximum_additional_cost === null || row.maximum_additional_cost === undefined
        ? undefined
        : Number(row.maximum_additional_cost),
    maximumApplications:
      row.maximum_applications === null || row.maximum_applications === undefined
        ? undefined
        : Number(row.maximum_applications),
    applicationsUsed: Number(row.applications_used),
    expiresAt: String(row.expires_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : undefined,
    createdBy: String(row.created_by),
  };
}

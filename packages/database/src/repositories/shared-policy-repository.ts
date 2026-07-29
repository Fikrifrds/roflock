import { sha256Canonical } from '@roleflock/contracts';
import type { SqliteDb } from '../client.js';

export interface StoredSharedPolicyBundle {
  id: string;
  organisationId: string;
  name: string;
  version: number;
  bundleDigest: string;
  bundle: Record<string, unknown>;
  status: 'active' | 'superseded' | 'revoked';
  createdBy: string;
  createdAt: string;
}

export interface ScopedCredentialGrant {
  id: string;
  organisationId: string;
  granteeActorId?: string;
  trustedRunnerId?: string;
  secretReference: string;
  capabilities: string[];
  projectIds: string[];
  status: 'active' | 'revoked' | 'expired';
  grantedBy: string;
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export class SharedPolicyRepository {
  constructor(private readonly db: SqliteDb) {}

  createBundle(value: StoredSharedPolicyBundle): StoredSharedPolicyBundle {
    if (sha256Canonical(value.bundle) !== value.bundleDigest) {
      throw new Error('Shared policy bundle digest is invalid');
    }
    this.db
      .prepare(
        `INSERT INTO shared_policy_bundles (
           id, organisation_id, name, version, bundle_digest, bundle_json,
           status, created_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.organisationId,
        value.name,
        value.version,
        value.bundleDigest,
        JSON.stringify(value.bundle),
        value.status,
        value.createdBy,
        value.createdAt,
      );
    return value;
  }

  assign(input: {
    id: string;
    policyBundleId: string;
    projectId?: string;
    roleId?: string;
    trustedRunnerId?: string;
    priority: number;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO shared_policy_assignments (
           id, policy_bundle_id, project_id, role_id, trusted_runner_id,
           priority, active, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        input.id,
        input.policyBundleId,
        input.projectId ?? null,
        input.roleId ?? null,
        input.trustedRunnerId ?? null,
        input.priority,
        input.createdAt,
      );
  }

  resolve(input: {
    organisationId: string;
    projectId?: string;
    roleId?: string;
    trustedRunnerId?: string;
  }): StoredSharedPolicyBundle[] {
    const rows = this.db
      .prepare(
        `SELECT b.*
         FROM shared_policy_bundles b
         JOIN shared_policy_assignments a ON a.policy_bundle_id = b.id
         WHERE b.organisation_id = ?
           AND b.status = 'active'
           AND a.active = 1
           AND (a.project_id IS NULL OR a.project_id = ?)
           AND (a.role_id IS NULL OR a.role_id = ?)
           AND (a.trusted_runner_id IS NULL OR a.trusted_runner_id = ?)
         ORDER BY a.priority ASC, b.name ASC, b.version DESC`,
      )
      .all(
        input.organisationId,
        input.projectId ?? null,
        input.roleId ?? null,
        input.trustedRunnerId ?? null,
      ) as Array<Record<string, unknown>>;
    return rows.map(mapBundle);
  }

  createCredentialGrant(value: ScopedCredentialGrant): ScopedCredentialGrant {
    if (!/^(keychain\.|secret\.|vault:\/\/)/.test(value.secretReference)) {
      throw new Error('Credential grants must store a secret reference, never a secret value');
    }
    this.db
      .prepare(
        `INSERT INTO scoped_credential_grants (
           id, organisation_id, grantee_actor_id, trusted_runner_id, secret_reference,
           capabilities_json, project_ids_json, status, granted_by, granted_at,
           expires_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.organisationId,
        value.granteeActorId ?? null,
        value.trustedRunnerId ?? null,
        value.secretReference,
        JSON.stringify([...new Set(value.capabilities)].sort()),
        JSON.stringify([...new Set(value.projectIds)].sort()),
        value.status,
        value.grantedBy,
        value.grantedAt,
        value.expiresAt ?? null,
        value.revokedAt ?? null,
      );
    return value;
  }

  credentialDecision(input: {
    grantId: string;
    capability: string;
    projectId: string;
    at: string;
  }): { allowed: boolean; reason: string; secretReference?: string } {
    const row = this.db
      .prepare(`SELECT * FROM scoped_credential_grants WHERE id = ?`)
      .get(input.grantId) as Record<string, unknown> | undefined;
    if (!row || row.status !== 'active') {
      return { allowed: false, reason: 'Credential grant is unavailable or inactive.' };
    }
    if (row.expires_at && Date.parse(String(row.expires_at)) <= Date.parse(input.at)) {
      return { allowed: false, reason: 'Credential grant has expired.' };
    }
    const capabilities = JSON.parse(String(row.capabilities_json)) as string[];
    const projects = JSON.parse(String(row.project_ids_json)) as string[];
    if (!capabilities.includes(input.capability) || !projects.includes(input.projectId)) {
      return { allowed: false, reason: 'Requested capability or project is outside grant scope.' };
    }
    return {
      allowed: true,
      reason: 'Credential reference may be resolved inside the scoped runner.',
      secretReference: String(row.secret_reference),
    };
  }
}

function mapBundle(row: Record<string, unknown>): StoredSharedPolicyBundle {
  return {
    id: String(row.id),
    organisationId: String(row.organisation_id),
    name: String(row.name),
    version: Number(row.version),
    bundleDigest: String(row.bundle_digest),
    bundle: JSON.parse(String(row.bundle_json)) as Record<string, unknown>,
    status: row.status as StoredSharedPolicyBundle['status'],
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
  };
}

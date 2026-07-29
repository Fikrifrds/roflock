import { sha256Canonical } from '@roleflock/contracts';
import type { SqliteDb } from '../client.js';

export interface StoredTransparencyEntry {
  id: string;
  organisationId: string;
  sequence: number;
  previousHash?: string;
  entryHash: string;
  entryType: string;
  subjectId: string;
  payloadDigest: string;
  occurredAt: string;
}

export interface StoredMultiPartyApprovalPolicy {
  id: string;
  organisationId: string;
  name: string;
  version: number;
  quorum: number;
  requiredRoles: string[];
  vetoRoles: string[];
  policyDigest: string;
  status: 'active' | 'superseded' | 'revoked';
  createdBy: string;
  createdAt: string;
}

export interface StoredPartyApprovalDecision {
  id: string;
  policyId: string;
  taskId: string;
  artifactDigest: string;
  actorId: string;
  actorRole: string;
  decision: 'approved' | 'rejected';
  signatureDigest: string;
  decidedAt: string;
}

export class TransparencyLogRepository {
  constructor(private readonly db: SqliteDb) {}

  append(input: {
    id: string;
    organisationId: string;
    entryType: string;
    subjectId: string;
    payloadDigest: string;
    occurredAt: string;
  }): StoredTransparencyEntry {
    return this.db.transaction(() => {
      const previous = this.list(input.organisationId).at(-1);
      const unsigned = {
        organisationId: input.organisationId,
        sequence: previous ? previous.sequence + 1 : 0,
        ...(previous ? { previousHash: previous.entryHash } : {}),
        entryType: input.entryType,
        subjectId: input.subjectId,
        payloadDigest: input.payloadDigest,
        occurredAt: input.occurredAt,
      };
      const entry: StoredTransparencyEntry = {
        id: input.id,
        ...unsigned,
        entryHash: sha256Canonical(unsigned),
      };
      this.db
        .prepare(
          `INSERT INTO transparency_log_entries (
             id, organisation_id, sequence, previous_hash, entry_hash, entry_type,
             subject_id, payload_digest, occurred_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.id,
          entry.organisationId,
          entry.sequence,
          entry.previousHash ?? null,
          entry.entryHash,
          entry.entryType,
          entry.subjectId,
          entry.payloadDigest,
          entry.occurredAt,
        );
      return entry;
    })();
  }

  list(organisationId: string): StoredTransparencyEntry[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM transparency_log_entries
           WHERE organisation_id = ? ORDER BY sequence ASC`,
        )
        .all(organisationId) as Array<Record<string, unknown>>
    ).map(mapEntry);
  }

  verify(organisationId: string): boolean {
    let previous: StoredTransparencyEntry | undefined;
    for (const entry of this.list(organisationId)) {
      const unsigned = {
        organisationId,
        sequence: previous ? previous.sequence + 1 : 0,
        ...(previous ? { previousHash: previous.entryHash } : {}),
        entryType: entry.entryType,
        subjectId: entry.subjectId,
        payloadDigest: entry.payloadDigest,
        occurredAt: entry.occurredAt,
      };
      if (
        entry.sequence !== unsigned.sequence ||
        entry.previousHash !== ('previousHash' in unsigned ? unsigned.previousHash : undefined) ||
        entry.entryHash !== sha256Canonical(unsigned)
      ) {
        return false;
      }
      previous = entry;
    }
    return true;
  }

  createPolicy(value: StoredMultiPartyApprovalPolicy): StoredMultiPartyApprovalPolicy {
    const digest = sha256Canonical({
      organisationId: value.organisationId,
      name: value.name,
      version: value.version,
      quorum: value.quorum,
      requiredRoles: [...new Set(value.requiredRoles)].sort(),
      vetoRoles: [...new Set(value.vetoRoles)].sort(),
    });
    if (digest !== value.policyDigest) throw new Error('Multi-party policy digest is invalid');
    this.db
      .prepare(
        `INSERT INTO multi_party_approval_policies (
           id, organisation_id, name, version, quorum, required_roles_json,
           veto_roles_json, policy_digest, status, created_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.organisationId,
        value.name,
        value.version,
        value.quorum,
        JSON.stringify([...new Set(value.requiredRoles)].sort()),
        JSON.stringify([...new Set(value.vetoRoles)].sort()),
        value.policyDigest,
        value.status,
        value.createdBy,
        value.createdAt,
      );
    return value;
  }

  decide(
    organisationId: string,
    value: StoredPartyApprovalDecision,
  ): StoredPartyApprovalDecision {
    return this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO multi_party_approval_decisions (
             id, policy_id, task_id, artifact_digest, actor_id, actor_role,
             decision, signature_digest, decided_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          value.id,
          value.policyId,
          value.taskId,
          value.artifactDigest,
          value.actorId,
          value.actorRole,
          value.decision,
          value.signatureDigest,
          value.decidedAt,
        );
      this.append({
        id: `${value.id}:log`,
        organisationId,
        entryType: 'approval.decided',
        subjectId: value.artifactDigest,
        payloadDigest: sha256Canonical(value),
        occurredAt: value.decidedAt,
      });
      return value;
    })();
  }

  listDecisions(policyId: string, artifactDigest: string): StoredPartyApprovalDecision[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM multi_party_approval_decisions
           WHERE policy_id = ? AND artifact_digest = ? ORDER BY decided_at ASC`,
        )
        .all(policyId, artifactDigest) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id),
      policyId: String(row.policy_id),
      taskId: String(row.task_id),
      artifactDigest: String(row.artifact_digest),
      actorId: String(row.actor_id),
      actorRole: String(row.actor_role),
      decision: row.decision as StoredPartyApprovalDecision['decision'],
      signatureDigest: String(row.signature_digest),
      decidedAt: String(row.decided_at),
    }));
  }
}

function mapEntry(row: Record<string, unknown>): StoredTransparencyEntry {
  return {
    id: String(row.id),
    organisationId: String(row.organisation_id),
    sequence: Number(row.sequence),
    previousHash: row.previous_hash ? String(row.previous_hash) : undefined,
    entryHash: String(row.entry_hash),
    entryType: String(row.entry_type),
    subjectId: String(row.subject_id),
    payloadDigest: String(row.payload_digest),
    occurredAt: String(row.occurred_at),
  };
}

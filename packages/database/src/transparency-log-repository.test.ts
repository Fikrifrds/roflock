import { afterEach, describe, expect, it } from 'vitest';
import { sha256Canonical } from '@roleflock/contracts';
import { migrate, openDatabase, type SqliteDb } from './client.js';
import { TransparencyLogRepository } from './repositories/transparency-log-repository.js';

let db: SqliteDb | undefined;
afterEach(() => db?.close());

describe('organisation transparency log', () => {
  it('appends a verifiable immutable hash chain', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    const at = '2026-07-28T12:00:00.000Z';
    db.prepare(
      `INSERT INTO organisations (id, slug, name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('org_1', 'roleflock', 'RoleFlock', 'active', at, at);
    seedActorAndTask(db, at);
    const log = new TransparencyLogRepository(db);
    const policyFields = {
      organisationId: 'org_1',
      name: 'critical-change',
      version: 1,
      quorum: 1,
      requiredRoles: ['owner'],
      vetoRoles: ['owner'],
    };
    log.createPolicy({
      id: 'policy_1',
      ...policyFields,
      policyDigest: sha256Canonical(policyFields),
      status: 'active',
      createdBy: 'actor_1',
      createdAt: at,
    });
    log.decide('org_1', {
      id: 'decision_1',
      policyId: 'policy_1',
      taskId: 'task_1',
      artifactDigest: 'd'.repeat(64),
      actorId: 'actor_1',
      actorRole: 'owner',
      decision: 'approved',
      signatureDigest: 'e'.repeat(64),
      decidedAt: at,
    });
    const first = log.append({
      id: 'entry_1',
      organisationId: 'org_1',
      entryType: 'approval.decided',
      subjectId: 'artifact_1',
      payloadDigest: 'a'.repeat(64),
      occurredAt: at,
    });
    const second = log.append({
      id: 'entry_2',
      organisationId: 'org_1',
      entryType: 'approval.decided',
      subjectId: 'artifact_1',
      payloadDigest: 'b'.repeat(64),
      occurredAt: '2026-07-28T12:01:00.000Z',
    });
    expect(second.previousHash).toBe(first.entryHash);
    expect(log.verify('org_1')).toBe(true);
    expect(log.listDecisions('policy_1', 'd'.repeat(64))).toHaveLength(1);
    expect(() =>
      db!.prepare(`UPDATE transparency_log_entries SET payload_digest = ? WHERE id = ?`).run(
        'c'.repeat(64),
        'entry_2',
      ),
    ).toThrow(/immutable/);
  });
});

function seedActorAndTask(database: SqliteDb, at: string): void {
  database
    .prepare(
      `INSERT INTO actors (
         id, actor_type, display_name, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run('actor_1', 'human', 'Owner', 'active', at, at);
  database
    .prepare(
      `INSERT INTO projects (
         id, workspace_id, name, repository_path, resolved_path, base_branch,
         status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('project_1', 'workspace_1', 'Core', '/repo', '/repo', 'main', 'active', at, at);
  database
    .prepare(
      `INSERT INTO tasks (
         id, project_id, type, title, brief, risk, state, workflow_graph_version_id,
         budget_policy_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'task_1',
      'project_1',
      'feature',
      'Approval',
      'Approval',
      'high',
      'READY_FOR_ACCEPTANCE',
      'graph_1',
      'budget_1',
      at,
      at,
    );
}

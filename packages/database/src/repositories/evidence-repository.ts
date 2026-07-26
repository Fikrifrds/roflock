import type { SqliteDb } from '../client.js';

export class EvidenceRepository {
  constructor(private readonly db: SqliteDb) {}

  addArtefact(input: {
    id: string;
    taskId: string;
    kind: string;
    path?: string;
    contentRef?: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO artefacts (id, task_id, kind, path, content_ref, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.taskId,
        input.kind,
        input.path ?? null,
        input.contentRef ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.createdAt,
      );
  }

  addTestRun(input: {
    id: string;
    taskId: string;
    nodeRunId?: string;
    command: string;
    exitCode?: number;
    stdoutRef?: string;
    stderrRef?: string;
    passed?: boolean;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO test_runs
          (id, task_id, node_run_id, command, exit_code, stdout_ref, stderr_ref, passed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.taskId,
        input.nodeRunId ?? null,
        input.command,
        input.exitCode ?? null,
        input.stdoutRef ?? null,
        input.stderrRef ?? null,
        input.passed === undefined ? null : input.passed ? 1 : 0,
        input.createdAt,
      );
  }

  addFinding(input: {
    id: string;
    taskId: string;
    nodeRunId?: string;
    severity: string;
    summary: string;
    details?: string;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO review_findings
          (id, task_id, node_run_id, severity, summary, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.taskId,
        input.nodeRunId ?? null,
        input.severity,
        input.summary,
        input.details ?? null,
        input.createdAt,
      );
  }

  addDisclosureManifest(input: {
    id: string;
    invocationId: string;
    providerConnectionId: string;
    selectedContext: unknown;
    exclusions: unknown;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO data_disclosure_manifests
          (id, invocation_id, provider_connection_id, selected_context_json, exclusions_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.invocationId,
        input.providerConnectionId,
        JSON.stringify(input.selectedContext),
        JSON.stringify(input.exclusions),
        input.createdAt,
      );
  }

  getBundle(taskId: string): {
    artefacts: unknown[];
    testRuns: unknown[];
    findings: unknown[];
    disclosures: unknown[];
  } {
    return {
      artefacts: this.db
        .prepare(`SELECT * FROM artefacts WHERE task_id = ? ORDER BY created_at ASC`)
        .all(taskId),
      testRuns: this.db
        .prepare(`SELECT * FROM test_runs WHERE task_id = ? ORDER BY created_at ASC`)
        .all(taskId),
      findings: this.db
        .prepare(`SELECT * FROM review_findings WHERE task_id = ? ORDER BY created_at ASC`)
        .all(taskId),
      disclosures: this.db
        .prepare(
          `SELECT d.* FROM data_disclosure_manifests d
           JOIN invocations i ON i.id = d.invocation_id
           JOIN node_runs n ON n.id = i.node_run_id
           JOIN graph_runs g ON g.id = n.graph_run_id
           WHERE g.task_id = ?
           ORDER BY d.created_at ASC`,
        )
        .all(taskId),
    };
  }
}

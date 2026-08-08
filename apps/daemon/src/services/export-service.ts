import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATABASE_FILE_NAME, DATABASE_FILE_NAMES } from '../data-dir.js';
import {
  buildEvidenceBundle,
  verifyEvidenceBundle,
  type EvidenceBundle,
} from '@roleflock/evidence';
import {
  AuditRepository,
  ConfirmationRepository,
  EvidenceRepository,
  TaskRepository,
  UsageRepository,
  type SqliteDb,
} from '@roleflock/database';
import { redact } from '@roleflock/observability';

export interface TaskAuditExport {
  taskId: string;
  exportedAt: string;
  task: unknown;
  confirmations: unknown[];
  usage: unknown;
  auditEvents: unknown[];
  graphRuns: unknown[];
  events: unknown[];
}

export interface DiagnosticsExport {
  exportedAt: string;
  product: string;
  version: string;
  host: string;
  dataDirPresent: boolean;
  databasePresent: boolean;
  documentCount: number;
  worktreeCount: number;
  taskCount: number;
  projectCount: number;
  recentAudit: unknown[];
  note: string;
}

export function buildTaskEvidenceExport(db: SqliteDb, taskId: string): EvidenceBundle {
  const bundle = new EvidenceRepository(db).getBundle(taskId);
  const items = [
    ...bundle.artefacts.map((content) => ({
      type: 'artefact',
      content: redact(content),
    })),
    ...bundle.testRuns.map((content) => ({
      type: 'test_run',
      content: redact(content),
    })),
    ...bundle.findings.map((content) => ({
      type: 'finding',
      content: redact(content),
    })),
    ...bundle.disclosures.map((content) => ({
      type: 'disclosure',
      content: redact(content),
    })),
  ];
  const evidence = buildEvidenceBundle(items);
  if (!verifyEvidenceBundle(evidence)) {
    throw new Error('Evidence bundle failed integrity verification');
  }
  return evidence;
}

export function buildTaskAuditExport(db: SqliteDb, taskId: string): TaskAuditExport {
  const task = new TaskRepository(db).get(taskId);
  const usage = new UsageRepository(db);
  const graphRuns = db
    .prepare(`SELECT * FROM graph_runs WHERE task_id = ? ORDER BY created_at ASC`)
    .all(taskId);
  const runIds = (graphRuns as Array<{ id: string }>).map((run) => run.id);
  const events =
    runIds.length === 0
      ? []
      : db
          .prepare(
            `SELECT * FROM events
             WHERE aggregate_id IN (${runIds.map(() => '?').join(',')})
             ORDER BY created_at ASC`,
          )
          .all(...runIds);

  return redact({
    taskId,
    exportedAt: new Date().toISOString(),
    task: task ?? null,
    confirmations: new ConfirmationRepository(db).listByTask(taskId),
    usage: {
      entries: usage.listByTask(taskId),
      summary: usage.summarize(taskId),
    },
    auditEvents: new AuditRepository(db).listByTarget('task', taskId),
    graphRuns,
    events,
  }) as TaskAuditExport;
}

export function buildDiagnosticsExport(db: SqliteDb, dataDir: string): DiagnosticsExport {
  const documentsDir = join(dataDir, 'documents');
  const worktreesDir = join(dataDir, 'worktrees');
  return redact({
    exportedAt: new Date().toISOString(),
    product: 'RoleFlock',
    version: '0.1.0',
    host: '127.0.0.1',
    dataDirPresent: existsSync(dataDir),
    databasePresent: existsSync(join(dataDir, DATABASE_FILE_NAME)),
    documentCount: countEntries(documentsDir),
    worktreeCount: countEntries(worktreesDir),
    taskCount: Number(
      (db.prepare(`SELECT COUNT(*) AS count FROM tasks`).get() as { count: number }).count,
    ),
    projectCount: Number(
      (db.prepare(`SELECT COUNT(*) AS count FROM projects`).get() as { count: number }).count,
    ),
    recentAudit: new AuditRepository(db).list(50),
    note: 'Diagnostics omit repository contents, API keys, and session tokens.',
  }) as DiagnosticsExport;
}

export function backupLocalData(dataDir: string): { backupDir: string; files: string[] } {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(dataDir, 'backups', stamp);
  mkdirSync(backupDir, { recursive: true });
  const files: string[] = [];
  for (const name of DATABASE_FILE_NAMES) {
    const path = join(dataDir, name);
    if (existsSync(path)) {
      copyFileSync(path, join(backupDir, name));
      files.push(name);
    }
  }
  return { backupDir, files };
}

export function deleteLocalData(dataDir: string): { deleted: string[] } {
  const deleted: string[] = [];
  for (const name of [
    ...DATABASE_FILE_NAMES,
    'provider-secrets.key',
    'provider-secrets.json',
    'documents',
    'worktrees',
  ]) {
    const path = join(dataDir, name);
    if (!existsSync(path)) continue;
    rmSync(path, { recursive: true, force: true });
    deleted.push(name);
  }
  mkdirSync(join(dataDir, 'documents'), { recursive: true });
  mkdirSync(join(dataDir, 'worktrees'), { recursive: true });
  return { deleted };
}

function countEntries(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory() || true;
      } catch {
        return false;
      }
    }).length;
  } catch {
    return 0;
  }
}

import type { SqliteDb } from '@roleflock/database';

/**
 * Explaining a run from what was durably recorded.
 *
 * The question this answers is "why should I believe this change is safe?", and
 * the only honest way to answer it is from records written while the run
 * happened — never by re-deriving anything afterwards.
 *
 * The governing rule is that **a missing link is shown, not omitted**. An
 * explanation that quietly skips the test report reads like a run that needed
 * no tests, which is precisely the impression evidence exists to prevent. Every
 * step is present in the output; a step with nothing behind it says so.
 */

export type StepStatus = 'recorded' | 'missing';

export interface EvidenceStep {
  /** Stable id so a UI and a CLI can agree on what they are showing. */
  id: string;
  /** What this link in the chain is meant to establish. */
  question: string;
  status: StepStatus;
  /** How many records back this step. */
  count: number;
  /** Content hashes, where the underlying record carries one. */
  hashes: string[];
  detail?: string;
}

export interface RunExplanation {
  taskId: string;
  /** Graph runs for this task, oldest first, with the identity each executed. */
  runs: Array<{
    id: string;
    graphVersionId: string;
    state: string;
    startedAt: string;
  }>;
  steps: EvidenceStep[];
  /** True when every step is backed by at least one record. */
  complete: boolean;
  /** What is missing, named plainly. */
  gaps: string[];
}

interface Row {
  [column: string]: unknown;
}

function rows(db: SqliteDb, sql: string, ...params: unknown[]): Row[] {
  try {
    return db.prepare(sql).all(...params) as Row[];
  } catch {
    // A table that does not exist in an older database is a gap, not a crash.
    return [];
  }
}

function hashesOf(records: Row[]): string[] {
  return records
    .map((record) => record['hash'] ?? record['content_hash'] ?? record['root_hash'])
    .filter((hash): hash is string => typeof hash === 'string');
}

function step(id: string, question: string, records: Row[], detail?: string): EvidenceStep {
  return {
    id,
    question,
    status: records.length > 0 ? 'recorded' : 'missing',
    count: records.length,
    hashes: hashesOf(records),
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * Assembles the chain a reviewer actually walks:
 *
 *   what was authorised → what was planned → what changed →
 *   what was verified → what was reviewed → who accepted it
 *
 * Each step cites durable records. Steps are always emitted in this order so
 * the shape of the answer does not change with the shape of the run.
 */
export function explainRun(db: SqliteDb, taskId: string): RunExplanation {
  const graphRuns = rows(
    db,
    `SELECT id, graph_version_id, state, started_at FROM graph_runs
      WHERE task_id = ? ORDER BY created_at ASC`,
    taskId,
  );

  const steps: EvidenceStep[] = [
    step(
      'contract',
      'What was authorised?',
      rows(db, `SELECT * FROM change_contracts WHERE task_id = ?`, taskId),
      'The intent a human approved before any work began.',
    ),
    step(
      'plan',
      'What was planned?',
      rows(db, `SELECT * FROM execution_plans WHERE task_id = ?`, taskId),
      'The plan the executor was pinned to, and any recorded deviation from it.',
    ),
    step(
      'artefacts',
      'What changed?',
      rows(db, `SELECT * FROM artefacts WHERE task_id = ? ORDER BY created_at ASC`, taskId),
      'Outputs produced by the run, hashed as they were recorded.',
    ),
    step(
      'verification',
      'What was verified, and did it pass?',
      rows(db, `SELECT * FROM test_runs WHERE task_id = ? ORDER BY created_at ASC`, taskId),
      'Deterministic checks. Their absence means nothing was proven, whatever an agent said.',
    ),
    step(
      'review',
      'What did independent review find?',
      rows(db, `SELECT * FROM review_findings WHERE task_id = ? ORDER BY created_at ASC`, taskId),
      'Findings raised against the change by a role that did not write it.',
    ),
    step(
      'approval',
      'Who accepted it?',
      rows(
        db,
        `SELECT * FROM confirmation_requests WHERE task_id = ? AND status IN ('approved','rejected')`,
        taskId,
      ),
      'Explicit human decisions. A run with none was never accepted by a person.',
    ),
    step(
      'disclosure',
      'What left the machine?',
      rows(
        db,
        `SELECT d.* FROM data_disclosure_manifests d
           JOIN invocations i ON i.id = d.invocation_id
           JOIN node_runs n ON n.id = i.node_run_id
           JOIN graph_runs g ON g.id = n.graph_run_id
          WHERE g.task_id = ? ORDER BY d.created_at ASC`,
        taskId,
      ),
      'Context sent to a provider, recorded per invocation.',
    ),
  ];

  const gaps = steps
    .filter((entry) => entry.status === 'missing')
    .map((entry) => `${entry.id}: ${entry.question}`);

  return {
    taskId,
    runs: graphRuns.map((run) => ({
      id: String(run['id']),
      graphVersionId: String(run['graph_version_id']),
      state: String(run['state']),
      startedAt: String(run['started_at']),
    })),
    steps,
    complete: gaps.length === 0,
    gaps,
  };
}

/**
 * Which recorded outputs touched a given file.
 *
 * Answers "why is this line here?" from provenance rather than from a diff:
 * a diff shows what changed, this shows which run, under which authorised
 * contract, produced it.
 */
export function explainFile(
  db: SqliteDb,
  taskId: string,
  path: string,
): Array<{ artefactId: string; kind: string; createdAt: string; hash?: string }> {
  const artefacts = rows(
    db,
    `SELECT * FROM artefacts WHERE task_id = ? ORDER BY created_at ASC`,
    taskId,
  );
  return artefacts
    .filter((record) => JSON.stringify(record).includes(path))
    .map((record) => ({
      artefactId: String(record['id']),
      kind: String(record['kind'] ?? 'artefact'),
      createdAt: String(record['created_at']),
      ...(typeof record['hash'] === 'string' ? { hash: record['hash'] } : {}),
    }));
}

/** Human-readable rendering, used by `roflock evidence`. */
export function renderExplanation(explanation: RunExplanation): string {
  const lines: string[] = [`Task ${explanation.taskId}`];

  if (explanation.runs.length === 0) {
    lines.push('  no graph run recorded');
  } else {
    for (const run of explanation.runs) {
      lines.push(`  run ${run.id}  ${run.graphVersionId}  ${run.state}  ${run.startedAt}`);
    }
  }

  lines.push('');
  for (const entry of explanation.steps) {
    const mark = entry.status === 'recorded' ? '✓' : '✗';
    const summary =
      entry.status === 'recorded'
        ? `${entry.count} record${entry.count === 1 ? '' : 's'}`
        : 'nothing recorded';
    lines.push(`  ${mark} ${entry.question.padEnd(38)} ${summary}`);
    if (entry.hashes.length > 0) {
      lines.push(`      ${entry.hashes.slice(0, 3).join(', ')}`);
    }
  }

  lines.push('');
  if (explanation.complete) {
    lines.push('  Every link in the chain is backed by a record.');
  } else {
    // Named, not hidden. A run missing its verification step must not read like
    // a run that needed none.
    lines.push('  Missing:');
    for (const gap of explanation.gaps) lines.push(`    - ${gap}`);
    lines.push('');
    lines.push('  An absent record is not evidence of absence of a problem.');
  }

  return lines.join('\n');
}

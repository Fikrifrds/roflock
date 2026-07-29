export const MIGRATION_014 = {
  version: 14,
  name: '014_verification_results',
  sql: `
CREATE TABLE verification_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  result_commit TEXT NOT NULL,
  specification_hash TEXT NOT NULL,
  mutation_analysis_digest TEXT NOT NULL,
  overall_outcome TEXT NOT NULL,
  decision_hash TEXT NOT NULL UNIQUE,
  decision_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX verification_runs_task_created
  ON verification_runs(task_id, created_at DESC);

CREATE TABLE verification_attestations (
  id TEXT PRIMARY KEY,
  verification_run_id TEXT NOT NULL REFERENCES verification_runs(id),
  task_id TEXT NOT NULL,
  check_id TEXT NOT NULL,
  attestation_hash TEXT NOT NULL UNIQUE,
  artifact_json TEXT NOT NULL
);

CREATE TABLE criterion_verdicts (
  verification_run_id TEXT NOT NULL REFERENCES verification_runs(id),
  criterion_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  verdict_json TEXT NOT NULL,
  PRIMARY KEY (verification_run_id, criterion_id)
);

CREATE TRIGGER verification_runs_immutable_update
BEFORE UPDATE ON verification_runs
BEGIN
  SELECT RAISE(ABORT, 'verification results are immutable');
END;

CREATE TRIGGER verification_runs_immutable_delete
BEFORE DELETE ON verification_runs
BEGIN
  SELECT RAISE(ABORT, 'verification results are immutable');
END;

CREATE TRIGGER verification_attestations_immutable_update
BEFORE UPDATE ON verification_attestations
BEGIN
  SELECT RAISE(ABORT, 'verification attestations are immutable');
END;

CREATE TRIGGER verification_attestations_immutable_delete
BEFORE DELETE ON verification_attestations
BEGIN
  SELECT RAISE(ABORT, 'verification attestations are immutable');
END;

CREATE TRIGGER criterion_verdicts_immutable_update
BEFORE UPDATE ON criterion_verdicts
BEGIN
  SELECT RAISE(ABORT, 'criterion verdicts are immutable');
END;

CREATE TRIGGER criterion_verdicts_immutable_delete
BEFORE DELETE ON criterion_verdicts
BEGIN
  SELECT RAISE(ABORT, 'criterion verdicts are immutable');
END;
`,
} as const;

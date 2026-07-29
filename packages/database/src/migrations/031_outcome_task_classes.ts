export const MIGRATION_031 = {
  version: 31,
  name: '031_outcome_task_classes',
  sql: `
CREATE TABLE outcome_task_classes (
  observation_id TEXT PRIMARY KEY REFERENCES outcome_observations(observation_id),
  normalizer_version TEXT NOT NULL,
  class_key TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  classification_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX outcome_task_classes_cohort
  ON outcome_task_classes(class_key, confidence);

CREATE TRIGGER outcome_task_classes_immutable_update
BEFORE UPDATE ON outcome_task_classes
BEGIN
  SELECT RAISE(ABORT, 'Outcome task classifications are immutable');
END;

CREATE TRIGGER outcome_task_classes_immutable_delete
BEFORE DELETE ON outcome_task_classes
BEGIN
  SELECT RAISE(ABORT, 'Outcome task classifications are immutable');
END;
`,
};

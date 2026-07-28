export const MIGRATION_009 = {
  version: 9,
  name: '009_task_contract_requirement',
  sql: `
-- Rows that predate this migration remain operable but are labelled honestly.
-- TaskRepository explicitly writes "required" for every newly created task.
ALTER TABLE tasks
  ADD COLUMN contract_requirement TEXT NOT NULL DEFAULT 'legacy_uncontracted'
  CHECK (contract_requirement IN ('required', 'legacy_uncontracted'));
`,
};

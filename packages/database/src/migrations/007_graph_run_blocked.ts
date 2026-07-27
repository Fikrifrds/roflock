export const MIGRATION_007 = {
  version: 7,
  name: '007_graph_run_blocked',
  sql: `
-- Why a run stopped, when the reason was a provider RoleFlock could not reach
-- rather than a defect in the work.
--
-- Kept apart from a plain failure because the distinction changes what the
-- operator should do: nothing is wrong with the work done so far, they need to
-- point the role at a model that will answer and start again. The run stays
-- resumable so that restart does not re-pay for the nodes that already
-- succeeded.
ALTER TABLE graph_runs ADD COLUMN blocked_role TEXT;
ALTER TABLE graph_runs ADD COLUMN blocked_reason TEXT;
ALTER TABLE graph_runs ADD COLUMN blocked_detail TEXT;
`,
};

export const MIGRATION_037 = {
  version: 37,
  name: '037_graph_run_resumed_loop_iterations',
  sql: `
-- The repair budget a graph run inherited from the run it resumed.
--
-- \`loop_attempts\` rows belong to a single run, but the repair budget belongs
-- to the task. Without this column, resuming counted only the latest run's own
-- rows, so a task interrupted twice silently forgot the re-entries the earlier
-- runs had already paid for and could spend the whole budget again.
--
-- A run that starts fresh records 0. The cumulative spend of a resume chain is
-- therefore this column plus the run's own \`loop_attempts\` rows, readable
-- from the latest run alone.
ALTER TABLE graph_runs ADD COLUMN resumed_loop_iterations INTEGER NOT NULL DEFAULT 0;
`,
};

export const MIGRATION_003 = {
  version: 3,
  name: 'local_knowledge_items',
  sql: `
CREATE TABLE IF NOT EXISTS local_knowledge_items (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  provenance TEXT,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_project ON local_knowledge_items(project_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_type ON local_knowledge_items(type);
`,
};

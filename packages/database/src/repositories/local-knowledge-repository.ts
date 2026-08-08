import type { SqliteDb } from '../client.js';

export type KnowledgeType =
  | 'architecture_decision'
  | 'coding_convention'
  | 'past_failure'
  | 'review_rule'
  | 'test_pattern'
  | 'security_rule'
  | 'rejected_approach';

export type KnowledgeState = 'candidate' | 'published';

export interface LocalKnowledgeItem {
  id: string;
  projectId?: string;
  type: KnowledgeType;
  title: string;
  body: string;
  provenance?: string;
  state: KnowledgeState;
  createdAt: string;
}

export class LocalKnowledgeRepository {
  constructor(private readonly db: SqliteDb) {}

  create(item: LocalKnowledgeItem): LocalKnowledgeItem {
    this.db
      .prepare(
        `INSERT INTO local_knowledge_items
          (id, project_id, type, title, body, provenance, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.projectId ?? null,
        item.type,
        item.title,
        item.body,
        item.provenance ?? null,
        item.state,
        item.createdAt,
      );
    return item;
  }

  list(
    filter: { projectId?: string; type?: string; state?: KnowledgeState; q?: string } = {},
  ): LocalKnowledgeItem[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.projectId) {
      clauses.push('(project_id = ? OR project_id IS NULL)');
      params.push(filter.projectId);
    }
    if (filter.type) {
      clauses.push('type = ?');
      params.push(filter.type);
    }
    if (filter.state) {
      clauses.push('state = ?');
      params.push(filter.state);
    }
    if (filter.q) {
      clauses.push('(title LIKE ? OR body LIKE ? OR provenance LIKE ?)');
      const like = `%${filter.q}%`;
      params.push(like, like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM local_knowledge_items ${where} ORDER BY created_at DESC`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      projectId: row.project_id ? String(row.project_id) : undefined,
      type: String(row.type) as KnowledgeType,
      title: String(row.title),
      body: String(row.body),
      provenance: row.provenance ? String(row.provenance) : undefined,
      state: String(row.state) as KnowledgeState,
      createdAt: String(row.created_at),
    }));
  }
}

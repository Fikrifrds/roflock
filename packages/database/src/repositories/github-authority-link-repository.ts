import type { SqliteDb } from '../client.js';

export interface GitHubAuthorityLink {
  id: string;
  taskId: string;
  contractId: string;
  contractHash: string;
  githubRepositoryMappingId: string;
  subjectType: 'issue' | 'pull_request';
  subjectNumber: number;
  subjectNodeId?: string;
  subjectUrl: string;
  linkType: 'authority_source' | 'delivery_target';
  linkedBy: string;
  linkedAt: string;
}

export class GitHubAuthorityLinkRepository {
  constructor(private readonly db: SqliteDb) {}

  create(value: GitHubAuthorityLink): GitHubAuthorityLink {
    this.db
      .prepare(
        `INSERT INTO github_authority_links (
           id, task_id, contract_id, contract_hash, github_repository_mapping_id,
           subject_type, subject_number, subject_node_id, subject_url, link_type,
           linked_by, linked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.taskId,
        value.contractId,
        value.contractHash,
        value.githubRepositoryMappingId,
        value.subjectType,
        value.subjectNumber,
        value.subjectNodeId ?? null,
        value.subjectUrl,
        value.linkType,
        value.linkedBy,
        value.linkedAt,
      );
    return value;
  }

  listByTask(taskId: string): GitHubAuthorityLink[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM github_authority_links
           WHERE task_id = ? ORDER BY linked_at ASC, id ASC`,
        )
        .all(taskId) as Array<Record<string, unknown>>
    ).map(mapLink);
  }
}

function mapLink(row: Record<string, unknown>): GitHubAuthorityLink {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    contractId: String(row.contract_id),
    contractHash: String(row.contract_hash),
    githubRepositoryMappingId: String(row.github_repository_mapping_id),
    subjectType: row.subject_type as GitHubAuthorityLink['subjectType'],
    subjectNumber: Number(row.subject_number),
    subjectNodeId: row.subject_node_id ? String(row.subject_node_id) : undefined,
    subjectUrl: String(row.subject_url),
    linkType: row.link_type as GitHubAuthorityLink['linkType'],
    linkedBy: String(row.linked_by),
    linkedAt: String(row.linked_at),
  };
}

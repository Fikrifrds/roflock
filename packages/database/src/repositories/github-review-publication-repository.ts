import type { SqliteDb } from '../client.js';

export interface GitHubReviewPublication {
  id: string;
  githubRepositoryMappingId: string;
  taskId: string;
  pullRequestNumber: number;
  commitSha: string;
  passportId: string;
  passportPayloadDigest: string;
  packetBodyDigest: string;
  githubCommentId?: string;
  githubCommentUrl?: string;
  publishedBy: string;
  publishedAt: string;
}

export class GitHubReviewPublicationRepository {
  constructor(private readonly db: SqliteDb) {}

  create(value: GitHubReviewPublication): GitHubReviewPublication {
    this.db
      .prepare(
        `INSERT INTO github_review_publications (
           id, github_repository_mapping_id, task_id, pull_request_number, commit_sha,
           passport_id, passport_payload_digest, packet_body_digest, github_comment_id,
           github_comment_url, published_by, published_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.githubRepositoryMappingId,
        value.taskId,
        value.pullRequestNumber,
        value.commitSha,
        value.passportId,
        value.passportPayloadDigest,
        value.packetBodyDigest,
        value.githubCommentId ?? null,
        value.githubCommentUrl ?? null,
        value.publishedBy,
        value.publishedAt,
      );
    return value;
  }

  listByTask(taskId: string): GitHubReviewPublication[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM github_review_publications
           WHERE task_id = ? ORDER BY published_at DESC, id DESC`,
        )
        .all(taskId) as Array<Record<string, unknown>>
    ).map(mapPublication);
  }
}

function mapPublication(row: Record<string, unknown>): GitHubReviewPublication {
  return {
    id: String(row.id),
    githubRepositoryMappingId: String(row.github_repository_mapping_id),
    taskId: String(row.task_id),
    pullRequestNumber: Number(row.pull_request_number),
    commitSha: String(row.commit_sha),
    passportId: String(row.passport_id),
    passportPayloadDigest: String(row.passport_payload_digest),
    packetBodyDigest: String(row.packet_body_digest),
    githubCommentId: row.github_comment_id ? String(row.github_comment_id) : undefined,
    githubCommentUrl: row.github_comment_url ? String(row.github_comment_url) : undefined,
    publishedBy: String(row.published_by),
    publishedAt: String(row.published_at),
  };
}

import type { SqliteDb } from '../client.js';

export interface GitHubCommentFeedbackReceipt {
  id: string;
  githubRepositoryMappingId: string;
  githubCommentId: string;
  subjectType: 'issue' | 'pull_request';
  subjectNumber: number;
  githubActorMappingId?: string;
  bodyDigest: string;
  feedbackId: string;
  receivedAt: string;
}

export class GitHubCommentFeedbackRepository {
  constructor(private readonly db: SqliteDb) {}

  create(value: GitHubCommentFeedbackReceipt): GitHubCommentFeedbackReceipt {
    this.db
      .prepare(
        `INSERT INTO github_comment_feedback (
           id, github_repository_mapping_id, github_comment_id, subject_type,
           subject_number, github_actor_mapping_id, body_digest, feedback_id, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.githubRepositoryMappingId,
        value.githubCommentId,
        value.subjectType,
        value.subjectNumber,
        value.githubActorMappingId ?? null,
        value.bodyDigest,
        value.feedbackId,
        value.receivedAt,
      );
    return value;
  }

  getByCommentId(githubCommentId: string): GitHubCommentFeedbackReceipt | undefined {
    const row = this.db
      .prepare(`SELECT * FROM github_comment_feedback WHERE github_comment_id = ?`)
      .get(githubCommentId) as Record<string, unknown> | undefined;
    return row ? mapReceipt(row) : undefined;
  }
}

function mapReceipt(row: Record<string, unknown>): GitHubCommentFeedbackReceipt {
  return {
    id: String(row.id),
    githubRepositoryMappingId: String(row.github_repository_mapping_id),
    githubCommentId: String(row.github_comment_id),
    subjectType: row.subject_type as GitHubCommentFeedbackReceipt['subjectType'],
    subjectNumber: Number(row.subject_number),
    githubActorMappingId: row.github_actor_mapping_id
      ? String(row.github_actor_mapping_id)
      : undefined,
    bodyDigest: String(row.body_digest),
    feedbackId: String(row.feedback_id),
    receivedAt: String(row.received_at),
  };
}

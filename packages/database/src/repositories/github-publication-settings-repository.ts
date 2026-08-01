import type { SqliteDb } from '../client.js';

export interface GitHubPublicationSettings {
  githubRepositoryMappingId: string;
  enabled: boolean;
  /** Secret-store reference for the token. Never the token itself. */
  tokenSecretId?: string;
  statusContext: string;
  publishReviewComments: boolean;
  updatedAt: string;
}

export const DEFAULT_STATUS_CONTEXT = 'roleflock/assurance';

export class GitHubPublicationSettingsRepository {
  constructor(private readonly db: SqliteDb) {}

  /**
   * Absent settings mean disabled.
   *
   * Returned rather than `undefined` so every caller reads the same shape and
   * cannot reach an outbound call by forgetting a null check.
   */
  get(githubRepositoryMappingId: string): GitHubPublicationSettings {
    const row = this.db
      .prepare('SELECT * FROM github_publication_settings WHERE github_repository_mapping_id = ?')
      .get(githubRepositoryMappingId) as Record<string, unknown> | undefined;
    if (!row) {
      return {
        githubRepositoryMappingId,
        enabled: false,
        statusContext: DEFAULT_STATUS_CONTEXT,
        publishReviewComments: false,
        updatedAt: '',
      };
    }
    return {
      githubRepositoryMappingId: row.github_repository_mapping_id as string,
      enabled: row.enabled === 1,
      ...(row.token_secret_id === null ? {} : { tokenSecretId: row.token_secret_id as string }),
      statusContext: row.status_context as string,
      publishReviewComments: row.publish_review_comments === 1,
      updatedAt: row.updated_at as string,
    };
  }

  upsert(value: GitHubPublicationSettings): GitHubPublicationSettings {
    this.db
      .prepare(
        `INSERT INTO github_publication_settings (
           github_repository_mapping_id, enabled, token_secret_id,
           status_context, publish_review_comments, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(github_repository_mapping_id) DO UPDATE SET
           enabled = excluded.enabled,
           token_secret_id = excluded.token_secret_id,
           status_context = excluded.status_context,
           publish_review_comments = excluded.publish_review_comments,
           updated_at = excluded.updated_at`,
      )
      .run(
        value.githubRepositoryMappingId,
        value.enabled ? 1 : 0,
        value.tokenSecretId ?? null,
        value.statusContext,
        value.publishReviewComments ? 1 : 0,
        value.updatedAt,
      );
    return this.get(value.githubRepositoryMappingId);
  }
}

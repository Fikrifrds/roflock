import type { SqliteDb } from '../client.js';

export interface GitHubStatusCheck {
  id: string;
  githubRepositoryMappingId: string;
  taskId: string;
  commitSha: string;
  checkRunId?: string;
  passportId?: string;
  passportPayloadDigest?: string;
  conclusion: 'success' | 'failure' | 'pending';
  summary: string;
  detailsUrl?: string;
  createdAt: string;
}

export type CommitStatusDecision =
  | { state: 'current'; check: GitHubStatusCheck }
  | { state: 'missing'; invalidatedCheck?: GitHubStatusCheck };

export class GitHubStatusCheckRepository {
  constructor(private readonly db: SqliteDb) {}

  create(value: GitHubStatusCheck): GitHubStatusCheck {
    this.db
      .prepare(
        `INSERT INTO github_status_checks (
           id, github_repository_mapping_id, task_id, commit_sha, check_run_id,
           passport_id, passport_payload_digest, conclusion, summary, details_url, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.githubRepositoryMappingId,
        value.taskId,
        value.commitSha,
        value.checkRunId ?? null,
        value.passportId ?? null,
        value.passportPayloadDigest ?? null,
        value.conclusion,
        value.summary,
        value.detailsUrl ?? null,
        value.createdAt,
      );
    return value;
  }

  evaluateCommit(githubRepositoryMappingId: string, commitSha: string): CommitStatusDecision {
    const current = this.latest(githubRepositoryMappingId, commitSha);
    if (current) return { state: 'current', check: current };
    const lastSuccess = this.db
      .prepare(
        `SELECT * FROM github_status_checks
         WHERE github_repository_mapping_id = ? AND conclusion = 'success'
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(githubRepositoryMappingId) as Record<string, unknown> | undefined;
    return {
      state: 'missing',
      ...(lastSuccess ? { invalidatedCheck: mapCheck(lastSuccess) } : {}),
    };
  }

  private latest(
    githubRepositoryMappingId: string,
    commitSha: string,
  ): GitHubStatusCheck | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM github_status_checks
         WHERE github_repository_mapping_id = ? AND commit_sha = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(githubRepositoryMappingId, commitSha) as Record<string, unknown> | undefined;
    return row ? mapCheck(row) : undefined;
  }
}

function mapCheck(row: Record<string, unknown>): GitHubStatusCheck {
  return {
    id: String(row.id),
    githubRepositoryMappingId: String(row.github_repository_mapping_id),
    taskId: String(row.task_id),
    commitSha: String(row.commit_sha),
    checkRunId: row.check_run_id ? String(row.check_run_id) : undefined,
    passportId: row.passport_id ? String(row.passport_id) : undefined,
    passportPayloadDigest: row.passport_payload_digest
      ? String(row.passport_payload_digest)
      : undefined,
    conclusion: row.conclusion as GitHubStatusCheck['conclusion'],
    summary: String(row.summary),
    detailsUrl: row.details_url ? String(row.details_url) : undefined,
    createdAt: String(row.created_at),
  };
}

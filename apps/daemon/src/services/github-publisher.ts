import {
  GitHubApiError,
  GitHubClient,
  type CommitStatusState,
} from '@roleflock/github-client';
import type {
  GitHubPublicationSettings,
  GitHubPublicationSettingsRepository,
  GitHubRepositoryMapping,
  GitHubStatusCheck,
} from '@roleflock/database';
import type { SecretStore } from '@roleflock/secret-store';

export type PublicationOutcome =
  | { published: true; target: string }
  | { published: false; reason: 'disabled' | 'no_credential'; detail: string }
  | { published: false; reason: 'failed'; detail: string; code: string };

export interface GitHubPublisherOptions {
  settings: GitHubPublicationSettingsRepository;
  secrets: SecretStore;
  /** Injected so a test can assert that nothing is called when disabled. */
  createClient?: (token: string) => GitHubClient;
}

/**
 * Sends the decisions RoleFlock already records to the place a reviewer or a
 * branch protection rule can see them.
 *
 * The decision itself is not made here. `GitHubStatusCheckRepository` decides
 * what the check says and `buildReviewPacket` decides what the comment
 * contains; this only carries them, so a transport failure can never change a
 * verdict.
 *
 * Publication is refused unless the repository has been explicitly opted in.
 * This is the first outbound call that carries a user's repository data, and
 * inferring consent from the presence of a mapping or a token would make it
 * possible to start sending without anyone having chosen to.
 */
export class GitHubPublisher {
  private readonly settings: GitHubPublicationSettingsRepository;
  private readonly secrets: SecretStore;
  private readonly createClient: (token: string) => GitHubClient;

  constructor(options: GitHubPublisherOptions) {
    this.settings = options.settings;
    this.secrets = options.secrets;
    this.createClient = options.createClient ?? ((token) => new GitHubClient({ token }));
  }

  async publishStatusCheck(input: {
    repository: GitHubRepositoryMapping;
    check: GitHubStatusCheck;
  }): Promise<PublicationOutcome> {
    const resolved = await this.resolve(input.repository.id);
    if ('reason' in resolved) return resolved;

    try {
      const status = await resolved.client.createCommitStatus({
        owner: input.repository.ownerLogin,
        repo: input.repository.name,
        sha: input.check.commitSha,
        state: statusState(input.check.conclusion),
        context: resolved.settings.statusContext,
        description: input.check.summary,
        ...(input.check.detailsUrl === undefined ? {} : { targetUrl: input.check.detailsUrl }),
      });
      return { published: true, target: status.url };
    } catch (error) {
      return failure(error);
    }
  }

  async publishReviewComment(input: {
    repository: GitHubRepositoryMapping;
    pullRequestNumber: number;
    body: string;
  }): Promise<PublicationOutcome> {
    const resolved = await this.resolve(input.repository.id);
    if ('reason' in resolved) return resolved;
    if (!resolved.settings.publishReviewComments) {
      return {
        published: false,
        reason: 'disabled',
        detail: 'Review packet comments are not enabled for this repository.',
      };
    }

    try {
      const comment = await resolved.client.createIssueComment({
        owner: input.repository.ownerLogin,
        repo: input.repository.name,
        issueNumber: input.pullRequestNumber,
        body: input.body,
      });
      return { published: true, target: comment.htmlUrl };
    } catch (error) {
      return failure(error);
    }
  }

  private async resolve(
    repositoryMappingId: string,
  ): Promise<
    { client: GitHubClient; settings: GitHubPublicationSettings } | Extract<PublicationOutcome, { published: false }>
  > {
    const settings = this.settings.get(repositoryMappingId);
    if (!settings.enabled) {
      return {
        published: false,
        reason: 'disabled',
        detail: 'GitHub publication is not enabled for this repository.',
      };
    }
    if (settings.tokenSecretId === undefined) {
      return {
        published: false,
        reason: 'no_credential',
        detail: 'GitHub publication is enabled but no token is stored.',
      };
    }
    const token = await this.secrets.get(settings.tokenSecretId);
    if (!token) {
      return {
        published: false,
        reason: 'no_credential',
        detail: `Stored GitHub token ${settings.tokenSecretId} is unavailable.`,
      };
    }
    return { client: this.createClient(token), settings };
  }
}

/**
 * A pending RoleFlock check is `pending` on GitHub, and anything that is not a
 * success is a `failure` rather than an `error`: `error` reads as the check
 * having broken, when a failed assurance decision is the check working.
 */
function statusState(conclusion: GitHubStatusCheck['conclusion']): CommitStatusState {
  if (conclusion === 'success') return 'success';
  if (conclusion === 'pending') return 'pending';
  return 'failure';
}

function failure(error: unknown): Extract<PublicationOutcome, { reason: 'failed' }> {
  if (error instanceof GitHubApiError) {
    const apiError: GitHubApiError = error;
    return { published: false, reason: 'failed', detail: apiError.message, code: apiError.code };
  }
  return {
    published: false,
    reason: 'failed',
    detail: error instanceof Error ? error.message : String(error),
    code: 'failed',
  };
}

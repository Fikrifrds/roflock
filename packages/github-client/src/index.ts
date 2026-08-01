/**
 * The smallest outbound GitHub surface RoleFlock needs to make a passport
 * mean something to someone other than the machine that produced it.
 *
 * Deliberately Commit Statuses rather than Check Runs. Check Runs require
 * GitHub App authentication, which means a private key, an installation token
 * exchange, and a webhook receiver; a commit status works with a fine-grained
 * token and can still be named as a required status check on a protected
 * branch. That is the property the product needs, at a fraction of the surface.
 *
 * Written against `fetch` rather than a client library: the repository has no
 * HTTP dependency, and three endpoints do not justify introducing one.
 */

export type GitHubFailureCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'failed';

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly code: GitHubFailureCode,
    readonly status: number,
    /** Present on `rate_limited`, when GitHub says when it will answer again. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export interface GitHubClientOptions {
  token: string;
  /** Overridden for GitHub Enterprise, and by tests. */
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export type CommitStatusState = 'success' | 'failure' | 'pending' | 'error';

export interface CommitStatusInput {
  owner: string;
  repo: string;
  sha: string;
  state: CommitStatusState;
  /** The status name a branch protection rule requires. Keep it stable. */
  context: string;
  description: string;
  targetUrl?: string;
}

export interface IssueCommentInput {
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}

export interface PullRequestSummary {
  number: number;
  headSha: string;
  state: string;
  htmlUrl: string;
}

/** GitHub truncates a longer status description; do it here so it is visible. */
const DESCRIPTION_LIMIT = 140;

export class GitHubClient {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(private readonly options: GitHubClientOptions) {
    this.apiBaseUrl = (options.apiBaseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? 'RoleFlock';
  }

  async createCommitStatus(input: CommitStatusInput): Promise<{ id: number; url: string }> {
    const body = await this.request<{ id: number; url: string }>(
      'POST',
      `/repos/${encode(input.owner)}/${encode(input.repo)}/statuses/${encode(input.sha)}`,
      {
        state: input.state,
        context: input.context,
        description: truncate(input.description, DESCRIPTION_LIMIT),
        ...(input.targetUrl === undefined ? {} : { target_url: input.targetUrl }),
      },
    );
    return { id: body.id, url: body.url };
  }

  async createIssueComment(input: IssueCommentInput): Promise<{ id: number; htmlUrl: string }> {
    const body = await this.request<{ id: number; html_url: string }>(
      'POST',
      `/repos/${encode(input.owner)}/${encode(input.repo)}/issues/${input.issueNumber}/comments`,
      { body: input.body },
    );
    return { id: body.id, htmlUrl: body.html_url };
  }

  async getPullRequest(input: {
    owner: string;
    repo: string;
    number: number;
  }): Promise<PullRequestSummary> {
    const body = await this.request<{
      number: number;
      state: string;
      html_url: string;
      head: { sha: string };
    }>('GET', `/repos/${encode(input.owner)}/${encode(input.repo)}/pulls/${input.number}`);
    return {
      number: body.number,
      headSha: body.head.sha,
      state: body.state,
      htmlUrl: body.html_url,
    };
  }

  private async request<T>(method: string, path: string, payload?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': this.userAgent,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });

    if (!response.ok) throw await failure(response);
    return (await response.json()) as T;
  }
}

async function failure(response: Response): Promise<GitHubApiError> {
  const detail = await response
    .text()
    .then((text) => extractMessage(text))
    .catch(() => '');
  const status = response.status;

  // A 403 with the remaining budget at zero is a rate limit, not a permission
  // problem. Reporting it as forbidden would send someone to check token
  // scopes for a condition that clears on its own.
  const remaining = response.headers.get('x-ratelimit-remaining');
  if (status === 429 || (status === 403 && remaining === '0')) {
    return new GitHubApiError(
      `GitHub rate limit reached${detail ? `: ${detail}` : ''}`,
      'rate_limited',
      status,
      retryAfter(response),
    );
  }
  if (status === 401) {
    return new GitHubApiError(
      `GitHub rejected the credential${detail ? `: ${detail}` : ''}`,
      'unauthorized',
      status,
    );
  }
  if (status === 403) {
    return new GitHubApiError(
      `GitHub denied the request${detail ? `: ${detail}` : ''}`,
      'forbidden',
      status,
    );
  }
  if (status === 404) {
    // 404 is also what GitHub returns for a repository a token cannot see, so
    // the message says both rather than asserting the resource is absent.
    return new GitHubApiError(
      `GitHub returned not found; the resource may not exist or the token may not see it${detail ? `: ${detail}` : ''}`,
      'not_found',
      status,
    );
  }
  return new GitHubApiError(
    `GitHub request failed with ${status}${detail ? `: ${detail}` : ''}`,
    'failed',
    status,
  );
}

function retryAfter(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (header !== null && Number.isFinite(Number(header))) return Number(header);
  const reset = response.headers.get('x-ratelimit-reset');
  if (reset === null || !Number.isFinite(Number(reset))) return undefined;
  return Math.max(0, Math.ceil(Number(reset) - Date.now() / 1000));
}

function extractMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message : '';
  } catch {
    return text.slice(0, 200);
  }
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function encode(segment: string): string {
  return encodeURIComponent(segment);
}

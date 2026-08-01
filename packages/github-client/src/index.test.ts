import { describe, expect, it } from 'vitest';
import { GitHubApiError, GitHubClient } from './index.js';

type Call = { url: string; init: RequestInit };

function stub(
  response: { status: number; body?: unknown; headers?: Record<string, string> },
): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(response.body ?? {}), {
      status: response.status,
      headers: response.headers,
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function client(fetchImpl: typeof fetch): GitHubClient {
  return new GitHubClient({ token: 'ghp_test', apiBaseUrl: 'https://api.test', fetchImpl });
}

describe('GitHubClient', () => {
  it('posts a commit status against the exact sha', async () => {
    const { fetchImpl, calls } = stub({ status: 201, body: { id: 7, url: 'https://api/status/7' } });
    const result = await client(fetchImpl).createCommitStatus({
      owner: 'acme',
      repo: 'core',
      sha: 'a'.repeat(40),
      state: 'success',
      context: 'roleflock/assurance',
      description: 'Passport pass',
      targetUrl: 'http://127.0.0.1:4178/tasks/1',
    });

    expect(result).toEqual({ id: 7, url: 'https://api/status/7' });
    expect(calls[0]!.url).toBe(`https://api.test/repos/acme/core/statuses/${'a'.repeat(40)}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      state: 'success',
      context: 'roleflock/assurance',
      description: 'Passport pass',
      target_url: 'http://127.0.0.1:4178/tasks/1',
    });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer ghp_test');
    expect(headers['x-github-api-version']).toBe('2022-11-28');
  });

  it('truncates a description GitHub would silently cut', async () => {
    const { fetchImpl, calls } = stub({ status: 201, body: { id: 1, url: 'u' } });
    await client(fetchImpl).createCommitStatus({
      owner: 'acme',
      repo: 'core',
      sha: 'b'.repeat(40),
      state: 'failure',
      context: 'roleflock/assurance',
      description: 'x'.repeat(500),
    });
    const description = (JSON.parse(String(calls[0]!.init.body)) as { description: string })
      .description;
    expect(description).toHaveLength(140);
    expect(description.endsWith('…')).toBe(true);
  });

  it('reads the head sha of a pull request', async () => {
    const { fetchImpl } = stub({
      status: 200,
      body: { number: 42, state: 'open', html_url: 'https://gh/pr/42', head: { sha: 'c'.repeat(40) } },
    });
    await expect(
      client(fetchImpl).getPullRequest({ owner: 'acme', repo: 'core', number: 42 }),
    ).resolves.toEqual({
      number: 42,
      headSha: 'c'.repeat(40),
      state: 'open',
      htmlUrl: 'https://gh/pr/42',
    });
  });

  it('separates an exhausted rate limit from a permission problem', async () => {
    const { fetchImpl } = stub({
      status: 403,
      body: { message: 'API rate limit exceeded' },
      headers: { 'x-ratelimit-remaining': '0', 'retry-after': '60' },
    });
    const error = (await client(fetchImpl)
      .createIssueComment({ owner: 'acme', repo: 'core', issueNumber: 1, body: 'x' })
      .catch((caught: unknown) => caught)) as GitHubApiError;

    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBe(60);
  });

  it('reports a genuine 403 as forbidden', async () => {
    const { fetchImpl } = stub({
      status: 403,
      body: { message: 'Resource not accessible by personal access token' },
      headers: { 'x-ratelimit-remaining': '4999' },
    });
    const error = (await client(fetchImpl)
      .createCommitStatus({
        owner: 'acme',
        repo: 'core',
        sha: 'd'.repeat(40),
        state: 'success',
        context: 'roleflock/assurance',
        description: 'ok',
      })
      .catch((caught: unknown) => caught)) as GitHubApiError;

    expect(error.code).toBe('forbidden');
    expect(error.message).toMatch(/not accessible by personal access token/);
  });

  it('does not claim a 404 resource is absent when the token may simply not see it', async () => {
    const { fetchImpl } = stub({ status: 404, body: { message: 'Not Found' } });
    const error = (await client(fetchImpl)
      .getPullRequest({ owner: 'acme', repo: 'private', number: 1 })
      .catch((caught: unknown) => caught)) as GitHubApiError;

    expect(error.code).toBe('not_found');
    expect(error.message).toMatch(/token may not see it/);
  });

  it('never puts the token in an error message', async () => {
    const { fetchImpl } = stub({ status: 401, body: { message: 'Bad credentials' } });
    const error = (await client(fetchImpl)
      .createIssueComment({ owner: 'acme', repo: 'core', issueNumber: 1, body: 'x' })
      .catch((caught: unknown) => caught)) as GitHubApiError;

    expect(error.code).toBe('unauthorized');
    expect(error.message).not.toContain('ghp_test');
  });
});

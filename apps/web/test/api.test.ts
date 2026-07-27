import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError, createApi } from '../src/lib/api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('api client session handling', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('consumes the launch token from the query string and scrubs the URL', async () => {
    window.history.replaceState(null, '', '/projects?rft=secret-token&keep=1');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ csrf: 'csrf-value' }));
    vi.stubGlobal('fetch', fetchMock);

    const api = createApi();
    expect(api.hasToken()).toBe(true);
    // The token must not survive in history, bookmarks, or a screen share.
    expect(window.location.search).toBe('?keep=1');
    expect(window.location.href).not.toContain('secret-token');

    await api.bootstrap();
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime/info', {
      headers: { 'x-roleflock-token': 'secret-token' },
    });
    expect(localStorage.getItem('roleflock-token')).toBe('secret-token');
    expect(localStorage.getItem('roleflock-csrf')).toBe('csrf-value');
  });

  it('also accepts the token from the URL fragment', () => {
    window.history.replaceState(null, '', '/#rft=hash-token');
    vi.stubGlobal('fetch', vi.fn());

    createApi();
    expect(localStorage.getItem('roleflock-token')).toBe('hash-token');
    expect(window.location.hash).toBe('');
  });

  it('reuses a stored token across reloads', () => {
    localStorage.setItem('roleflock-token', 'stored-token');
    vi.stubGlobal('fetch', vi.fn());
    expect(createApi().hasToken()).toBe(true);
  });

  it('throws UnauthorizedError and clears state when the daemon rejects the token', async () => {
    localStorage.setItem('roleflock-token', 'stale');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 401)));

    const api = createApi();
    await expect(api.bootstrap()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(localStorage.getItem('roleflock-token')).toBeNull();
    expect(api.hasToken()).toBe(false);
  });

  it('sends the token and CSRF header on mutations', async () => {
    localStorage.setItem('roleflock-token', 'tok');
    localStorage.setItem('roleflock-csrf', 'csrf');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await createApi().request('/api/projects', { method: 'POST', body: '{}' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      'x-roleflock-token': 'tok',
      'x-roleflock-csrf': 'csrf',
      'content-type': 'application/json',
    });
  });

  it('never puts the token in the event stream URL', () => {
    localStorage.setItem('roleflock-token', 'tok');
    vi.stubGlobal('fetch', vi.fn());

    const close = createApi().stream(() => {});
    const source = (globalThis.EventSource as unknown as { instances: Array<{ url: string }> })
      .instances[0];
    expect(source?.url).toBe('/api/events/stream');
    expect(source?.url).not.toContain('tok');
    close();
  });

  it('re-bootstraps once on a stale CSRF rejection, then gives up', async () => {
    localStorage.setItem('roleflock-token', 'tok');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Invalid CSRF token' }, 403))
      .mockResolvedValueOnce(jsonResponse({ csrf: 'fresh' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createApi().request('/api/tasks', { method: 'POST' })).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

export type ApiClient = ReturnType<typeof createApi>;
export function createApi() {
  let token = localStorage.getItem('roleflock-token') ?? '';
  let csrf = localStorage.getItem('roleflock-csrf') ?? '';
  async function bootstrap() { const info = await fetch('/api/runtime/info').then((r) => r.json()); token = info.token; csrf = info.csrf; localStorage.setItem('roleflock-token', token); localStorage.setItem('roleflock-csrf', csrf); return info; }
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = {
      'x-roleflock-token': token,
      ...(method !== 'GET' && method !== 'HEAD'
        ? { 'content-type': 'application/json', 'x-roleflock-csrf': csrf }
        : {}),
      ...(init.headers as Record<string, string> | undefined),
    };
    const response = await fetch(path, {
      ...init,
      headers,
      body: init.body ?? (method !== 'GET' && method !== 'HEAD' ? '{}' : undefined),
    });
    if (!response.ok) {
      throw new Error(
        ((await response.json().catch(() => ({}))) as { error?: string }).error ??
          response.statusText,
      );
    }
    return response.json() as Promise<T>;
  }
  return { bootstrap, request, stream: (onEvent: () => void) => { const source = new EventSource(`/api/events/stream?token=${encodeURIComponent(token)}`); source.onmessage = onEvent; return () => source.close(); } };
}

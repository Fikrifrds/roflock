import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

const servers: Awaited<ReturnType<typeof createServer>>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(({ app }) => app.close())); });
async function server() { const instance = await createServer({ dataDir: await mkdtemp(join(tmpdir(), 'roleflock-')), session: { token: 'test-token', csrf: 'test-csrf' } }); servers.push(instance); return instance; }

describe('daemon boundary', () => {
  it('defaults to loopback-only bind', async () => expect((await server()).host).toBe('127.0.0.1'));
  it('has no raw shell execution endpoint', async () => { const { app } = await server(); expect((await app.inject({ method: 'POST', url: '/api/shell', headers: { 'x-roleflock-token': 'test-token', 'x-roleflock-csrf': 'test-csrf' } })).statusCode).toBe(404); });
  it('rejects unauthenticated API requests', async () => { const { app } = await server(); expect((await app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(401); });
  it('registers openai-compatible custom providers', async () => {
    const { app } = await server();
    const headers = {
      'x-roleflock-token': 'test-token',
      'x-roleflock-csrf': 'test-csrf',
      'content-type': 'application/json',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/providers',
      headers,
      payload: {
        displayName: 'Local OpenAI',
        endpoint: 'http://127.0.0.1:11434/v1',
        model: 'llama3.2',
        apiKey: '',
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { id: string; connectionType: string; status: string };
    expect(body.connectionType).toBe('openai-compatible');
    expect(body.status).toBe('ready');

    const listed = await app.inject({ method: 'GET', url: '/api/providers', headers });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as Array<{ id: string }>).some((p) => p.id === body.id)).toBe(true);
  });
  it('exposes authenticated choose-directory dialog endpoint', async () => {
    const { app } = await server();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/dialogs/choose-directory',
          headers: { 'content-type': 'application/json' },
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
  });
});

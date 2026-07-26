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

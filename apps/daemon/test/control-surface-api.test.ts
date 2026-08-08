import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe('control-surface API v1', () => {
  it('is authenticated and advertises only the existing governed runtime', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'roflock-control-api-'));
    const instance = await createServer({
      dataDir,
      session: { token: 'test-token', csrf: 'test-csrf' },
    });
    cleanup.push(async () => {
      await instance.app.close();
      await rm(dataDir, { recursive: true, force: true });
    });

    const denied = await instance.app.inject({ method: 'GET', url: '/api/control/v1' });
    expect(denied.statusCode).toBe(401);

    const response = await instance.app.inject({
      method: 'GET',
      url: '/api/control/v1',
      headers: { 'x-roleflock-token': 'test-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      apiVersion: '1.0',
      transport: 'authenticated-loopback-http',
      authentication: { tokenInUrl: false, csrfRequiredFor: ['POST'] },
      operations: {
        startRun: { method: 'POST', path: '/api/runtime/runs' },
        events: { method: 'GET', path: '/api/runs/{runId}/events?after={sequence}' },
        decideApproval: {
          method: 'POST',
          path: '/api/approvals/{approvalId}/{approve|reject}',
        },
      },
      semantics: {
        approval: 'one explicit pending approval ID; no approve-all operation',
      },
    });
    expect(JSON.stringify(response.json())).not.toContain('test-token');
    expect(JSON.stringify(response.json())).not.toContain('second runtime');
  });
});

import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

const servers: Awaited<ReturnType<typeof createServer>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(({ app }) => app.close()));
});
async function server() {
  const instance = await createServer({
    dataDir: await mkdtemp(join(tmpdir(), 'roleflock-')),
    session: { token: 'test-token', csrf: 'test-csrf' },
  });
  servers.push(instance);
  return instance;
}

describe('daemon boundary', () => {
  it('defaults to loopback-only bind', async () => expect((await server()).host).toBe('127.0.0.1'));
  it('has no raw shell execution endpoint', async () => {
    const { app } = await server();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/shell',
          headers: { 'x-roleflock-token': 'test-token', 'x-roleflock-csrf': 'test-csrf' },
        })
      ).statusCode,
    ).toBe(404);
  });
  it('rejects unauthenticated API requests', async () => {
    const { app } = await server();
    expect((await app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(401);
  });
  it('rejects mutations with invalid CSRF', async () => {
    const { app } = await server();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: {
        'x-roleflock-token': 'test-token',
        'x-roleflock-csrf': 'wrong',
        'content-type': 'application/json',
      },
      payload: { path: '/tmp' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toMatch(/CSRF/i);
  });
  it('allows authenticated GET without CSRF header', async () => {
    const { app } = await server();
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { 'x-roleflock-token': 'test-token' },
    });
    expect(res.statusCode).toBe(200);
  });
  it('rejects mutations from non-local origins', async () => {
    const { app } = await server();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: {
        'x-roleflock-token': 'test-token',
        'x-roleflock-csrf': 'test-csrf',
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      payload: { path: '/tmp' },
    });
    expect(res.statusCode).toBe(403);
  });
  it('does not hand out the session token to unauthenticated callers', async () => {
    const { app } = await server();
    const res = await app.inject({ method: 'GET', url: '/api/runtime/info' });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('test-token');
  });
  it('never returns the session token in runtime info', async () => {
    const { app } = await server();
    const res = await app.inject({
      method: 'GET',
      url: '/api/runtime/info',
      headers: { 'x-roleflock-token': 'test-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('test-token');
    expect(res.json()).toMatchObject({ csrf: 'test-csrf' });
    expect(res.headers['set-cookie']?.toString()).toMatch(/HttpOnly/i);
  });
  it('rejects a token supplied in the query string', async () => {
    const { app } = await server();
    const res = await app.inject({ method: 'GET', url: '/api/projects?token=test-token' });
    expect(res.statusCode).toBe(401);
  });
  it('accepts the session cookie so the event stream needs no URL token', async () => {
    const { app } = await server();
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      cookies: { roleflock_token: 'test-token' },
    });
    expect(res.statusCode).toBe(200);
  });
  it('rejects reads from non-local origins', async () => {
    const { app } = await server();
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { 'x-roleflock-token': 'test-token', origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
  });
  it('stores the session token in a file only this user can read', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'roleflock-session-'));
    const instance = await createServer({ dataDir });
    servers.push(instance);
    const file = join(dataDir, 'session.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(await readFile(file, 'utf8')) as { token: string };
    expect(stored.token).toBe(instance.session.token);

    // A restart reuses the stored session so the launch URL stays valid.
    await instance.app.close();
    servers.splice(servers.indexOf(instance), 1);
    const restarted = await createServer({ dataDir });
    servers.push(restarted);
    expect(restarted.session.token).toBe(instance.session.token);
  });
  it('exposes privacy claims for local-first onboarding', async () => {
    const { app } = await server();
    const res = await app.inject({
      method: 'GET',
      url: '/api/privacy',
      headers: { 'x-roleflock-token': 'test-token' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { localOnly: boolean }).localOnly).toBe(true);
  });
  it('exposes version without repository data', async () => {
    const { app } = await server();
    const res = await app.inject({
      method: 'GET',
      url: '/api/version',
      headers: { 'x-roleflock-token': 'test-token' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { product: string; version: string; platform: string };
    expect(body.product).toBe('RoleFlock');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.platform).toBeTruthy();
  });
  it('checks updates offline without sending repository data', async () => {
    const previous = process.env.ROLEFLOCK_UPDATE_URL;
    delete process.env.ROLEFLOCK_UPDATE_URL;
    try {
      const { app } = await server();
      const res = await app.inject({
        method: 'GET',
        url: '/api/updates/check',
        headers: { 'x-roleflock-token': 'test-token' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        updateAvailable: boolean;
        channel: string;
        note: string;
      };
      expect(body.updateAvailable).toBe(false);
      expect(body.channel).toBe('local');
      expect(body.note).toMatch(/do not transmit repository contents/i);
    } finally {
      if (previous === undefined) delete process.env.ROLEFLOCK_UPDATE_URL;
      else process.env.ROLEFLOCK_UPDATE_URL = previous;
    }
  });
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
    const providers = listed.json() as Array<{ id: string }>;
    expect(providers.some((p) => p.id === body.id)).toBe(true);
  });
  it('exposes provider account and auth action endpoints', async () => {
    const { app } = await server();
    const headers = {
      'x-roleflock-token': 'test-token',
      'x-roleflock-csrf': 'test-csrf',
    };
    const account = await app.inject({
      method: 'GET',
      url: '/api/providers/claude/account',
      headers,
    });
    expect(account.statusCode).toBe(200);
    const body = account.json() as {
      account: { providerId: string; supportsLogin: boolean };
      localUsage: { note: string };
    };
    expect(body.account.providerId).toBe('claude');
    expect(body.localUsage.note).toMatch(/local meter/i);

    const listed = await app.inject({ method: 'GET', url: '/api/providers', headers });
    expect(
      (listed.json() as Array<{ id: string; localUsage?: { entryCount: number } }>).every(
        (provider) => provider.id === 'fake' || typeof provider.localUsage?.entryCount === 'number',
      ),
    ).toBe(true);
  });
  it('recommends smallest sufficient workflows from task intent', async () => {
    const { app } = await server();
    const headers = {
      'x-roleflock-token': 'test-token',
      'x-roleflock-csrf': 'test-csrf',
    };
    const recommended = await app.inject({
      method: 'GET',
      url: '/api/workflows/recommend?type=investigation&risk=low',
      headers,
    });
    expect(recommended.statusCode).toBe(200);
    expect((recommended.json() as { mode: string }).mode).toBe('direct');

    const intents = await app.inject({ method: 'GET', url: '/api/task-intents', headers });
    expect(intents.statusCode).toBe(200);
    expect((intents.json() as Array<{ id: string }>).some((i) => i.id === 'bug_fix')).toBe(true);
  });
  it('exposes local usage with separated actual and shadow costs', async () => {
    const { app } = await server();
    const headers = {
      'x-roleflock-token': 'test-token',
      'x-roleflock-csrf': 'test-csrf',
    };
    const summary = await app.inject({ method: 'GET', url: '/api/usage/summary', headers });
    expect(summary.statusCode).toBe(200);
    const body = summary.json() as {
      scope: string;
      actualCostUsd: number;
      shadowCostUsd: number;
      note: string;
    };
    expect(body.scope).toBe('local-daemon');
    expect(body.note).toMatch(/not provider account-wide/i);
    expect(typeof body.actualCostUsd).toBe('number');
    expect(typeof body.shadowCostUsd).toBe('number');

    const prices = await app.inject({ method: 'GET', url: '/api/price-cards', headers });
    expect(prices.statusCode).toBe(200);
    expect((prices.json() as unknown[]).length).toBeGreaterThan(0);

    const quota = await app.inject({ method: 'GET', url: '/api/quota', headers });
    expect(quota.statusCode).toBe(200);
    expect((quota.json() as Array<{ confidence: string }>)[0]?.confidence).toBe('unknown');
  });
  it('stores supporting documents with hash without requiring them to start', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { execFileSync } = await import('node:child_process');
    const dataDir = await mkdtemp(join(tmpdir(), 'rf-doc-data-'));
    const repoDir = await mkdtemp(join(tmpdir(), 'rf-doc-repo-'));
    execFileSync('git', ['init'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'RoleFlock'], { cwd: repoDir });
    await writeFile(join(repoDir, 'README.md'), '# fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });

    const session = { token: 'test-token', csrf: 'test-csrf' };
    const instance = await createServer({ dataDir, session });
    const headers = {
      'x-roleflock-token': session.token,
      'x-roleflock-csrf': session.csrf,
      'content-type': 'application/json',
    };
    try {
      const project = await instance.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers,
        payload: { path: repoDir },
      });
      expect(project.statusCode).toBe(201);
      const projectId = (project.json() as { id: string }).id;

      const task = await instance.app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers,
        payload: {
          projectId,
          type: 'feature',
          title: 'With docs',
          brief: 'Attach a PRD optionally',
          mode: 'direct',
        },
      });
      expect(task.statusCode).toBe(201);
      const taskId = (task.json() as { id: string }).id;

      const empty = await instance.app.inject({
        method: 'GET',
        url: `/api/tasks/${taskId}/documents`,
        headers,
      });
      expect(empty.statusCode).toBe(200);
      expect(empty.json()).toEqual([]);

      const uploaded = await instance.app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/documents`,
        headers,
        payload: {
          fileName: 'prd.md',
          kind: 'prd',
          authority: 'reference',
          content: '# Product\nShip local docs.\n',
          mimeType: 'text/markdown',
        },
      });
      expect(uploaded.statusCode).toBe(201);
      const doc = uploaded.json() as { sha256: string; hasExtractedText: boolean };
      expect(doc.sha256).toHaveLength(64);
      expect(doc.hasExtractedText).toBe(true);

      const listed = await instance.app.inject({
        method: 'GET',
        url: `/api/tasks/${taskId}/documents`,
        headers,
      });
      expect((listed.json() as unknown[]).length).toBe(1);
    } finally {
      await instance.app.close();
      await rm(dataDir, { recursive: true, force: true });
      await rm(repoDir, { recursive: true, force: true });
    }
  });
  it('exposes role contracts and context preview', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { execFileSync } = await import('node:child_process');
    const dataDir = await mkdtemp(join(tmpdir(), 'rf-ctx-data-'));
    const repoDir = await mkdtemp(join(tmpdir(), 'rf-ctx-repo-'));
    execFileSync('git', ['init'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'RoleFlock'], { cwd: repoDir });
    await writeFile(join(repoDir, 'README.md'), '# fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });
    const session = { token: 'test-token', csrf: 'test-csrf' };
    const instance = await createServer({ dataDir, session });
    const headers = {
      'x-roleflock-token': session.token,
      'x-roleflock-csrf': session.csrf,
      'content-type': 'application/json',
    };
    try {
      const contracts = await instance.app.inject({
        method: 'GET',
        url: '/api/roles/contracts',
        headers,
      });
      expect(contracts.statusCode).toBe(200);
      expect((contracts.json() as unknown[]).length).toBeGreaterThan(0);

      const project = await instance.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers,
        payload: { path: repoDir },
      });
      const projectId = (project.json() as { id: string }).id;
      await instance.app.inject({
        method: 'POST',
        url: '/api/knowledge',
        headers,
        payload: {
          projectId,
          type: 'coding_convention',
          title: 'Prefer leased writes',
          body: 'Writer paths must use the permission envelope.',
          state: 'published',
          provenance: 'test',
        },
      });
      const task = await instance.app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers,
        payload: {
          projectId,
          type: 'feature',
          title: 'Context preview',
          brief: 'Compile context',
          mode: 'direct',
        },
      });
      const taskId = (task.json() as { id: string }).id;
      const preview = await instance.app.inject({
        method: 'GET',
        url: `/api/tasks/${taskId}/context-preview?role=planner`,
        headers,
      });
      expect(preview.statusCode).toBe(200);
      const body = preview.json() as {
        totalTokens: number;
        entries: unknown[];
        exclusions: string[];
      };
      expect(body.totalTokens).toBeGreaterThan(0);
      expect(body.entries.length).toBeGreaterThan(0);
      expect(body.exclusions).toContain('.env');
    } finally {
      await instance.app.close();
      await rm(dataDir, { recursive: true, force: true });
      await rm(repoDir, { recursive: true, force: true });
    }
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
  it('creates and lists approval grants for a project', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { randomUUID } = await import('node:crypto');
    const { openMigratedDatabase, ProjectRepository } = await import('@roleflock/database');
    const dataDir = await mkdtemp(join(tmpdir(), 'rf-grant-data-'));
    const session = { token: 'test-token', csrf: 'test-csrf' };
    const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
    const time = new Date().toISOString();
    const projectId = randomUUID();
    new ProjectRepository(db).create({
      id: projectId,
      workspaceId: 'local',
      name: 'Grant test',
      repositoryPath: '/tmp',
      resolvedPath: '/tmp',
      baseBranch: 'HEAD',
      status: 'active',
      createdAt: time,
      updatedAt: time,
    });
    db.close();
    const instance = await createServer({ dataDir, session });
    const headers = {
      'x-roleflock-token': session.token,
      'x-roleflock-csrf': session.csrf,
      'content-type': 'application/json',
    };
    try {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const created = await instance.app.inject({
        method: 'POST',
        url: '/api/approval-grants',
        headers,
        payload: {
          projectId,
          scope: 'exact_fingerprint',
          fingerprint: 'abc123fingerprint',
          maximumRisk: 'medium',
          expiresAt,
          maximumApplications: 5,
        },
      });
      expect(created.statusCode).toBe(201);
      const grant = created.json() as { id: string; scope: string; fingerprint?: string };
      expect(grant.scope).toBe('exact_fingerprint');
      expect(grant.fingerprint).toBe('abc123fingerprint');

      const listed = await instance.app.inject({
        method: 'GET',
        url: `/api/approval-grants?projectId=${projectId}`,
        headers,
      });
      expect(listed.statusCode).toBe(200);
      expect((listed.json() as Array<{ id: string }>).some((row) => row.id === grant.id)).toBe(
        true,
      );

      const revoked = await instance.app.inject({
        method: 'POST',
        url: `/api/approval-grants/${grant.id}/revoke`,
        headers,
        payload: {},
      });
      expect(revoked.statusCode).toBe(200);
    } finally {
      await instance.app.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
  it('lists knowledge items after create', async () => {
    const { app } = await server();
    const headers = {
      'x-roleflock-token': 'test-token',
      'x-roleflock-csrf': 'test-csrf',
      'content-type': 'application/json',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/knowledge',
      headers,
      payload: {
        type: 'review_rule',
        title: 'Always cite documents',
        body: 'Findings must reference attached PRDs when present.',
        state: 'published',
      },
    });
    expect(created.statusCode).toBe(201);
    const listed = await app.inject({
      method: 'GET',
      url: '/api/knowledge?state=published',
      headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(
      (listed.json() as Array<{ title: string }>).some(
        (item) => item.title === 'Always cite documents',
      ),
    ).toBe(true);
  });
});

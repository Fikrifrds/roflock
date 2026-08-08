import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase, WorkflowSnapshotRepository } from '@roleflock/database';
import { createServer } from '../src/server.js';
import { DATABASE_FILE_NAME } from '../src/data-dir.js';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()!();
});

const headers = {
  'x-roleflock-token': 'test-token',
  'x-roleflock-csrf': 'test-csrf',
  'content-type': 'application/json',
};

async function boot() {
  const dataDir = await mkdtemp(join(tmpdir(), 'rf-runtime-api-data-'));
  const repoDir = await mkdtemp(join(tmpdir(), 'rf-runtime-api-repo-'));
  execFileSync('git', ['init'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'runtime@test.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Runtime Test'], { cwd: repoDir });
  await writeFile(join(repoDir, 'README.md'), '# fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });

  const instance = await createServer({
    dataDir,
    session: { token: 'test-token', csrf: 'test-csrf' },
  });
  cleanup.push(async () => {
    await instance.app.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  });
  return { ...instance, repoDir, dataDir };
}

const source = `workflow cli_smoke { version "1.0.0" }
role implementer { write }
agent Prepare { role implementer objective "prepare the repository" }
check Clean { run "git status --short" required }
human Accept
flow { Prepare -> Clean
       Clean.pass -> Accept }
`;

describe('runtime CLI API', () => {
  it('registers a repository idempotently and starts an immutable authored workflow', async () => {
    const { app, repoDir, dataDir } = await boot();
    const first = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: { path: repoDir },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: { path: repoDir },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ id: (first.json() as { id: string }).id });

    const started = await app.inject({
      method: 'POST',
      url: '/api/runtime/runs',
      headers,
      payload: {
        projectId: (first.json() as { id: string }).id,
        source,
        title: 'CLI smoke',
        brief: 'Prove arbitrary source runs through the canonical runtime',
        allowUncontracted: true,
      },
    });
    expect(started.statusCode).toBe(202);
    const body = started.json() as {
      taskId: string;
      graphRunId: string;
      workflowId: string;
      semanticHash: string;
      contract: { mode: string; warning: string };
    };
    expect(body).toMatchObject({
      workflowId: 'cli_smoke',
      contract: { mode: 'legacy_uncontracted' },
    });
    expect(body.graphRunId).toBeTruthy();
    expect(body.semanticHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const status = await app.inject({
      method: 'GET',
      url: `/api/runs/${body.graphRunId}`,
      headers,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      id: body.graphRunId,
      taskId: body.taskId,
      graphVersionId: 'cli_smoke@3',
    });
    expect(status.json()).toHaveProperty('nodeCounts');

    const eventResponse = await app.inject({
      method: 'GET',
      url: `/api/runs/${body.graphRunId}/events?after=0`,
      headers,
    });
    expect(eventResponse.statusCode).toBe(200);
    const runtimeEvents = eventResponse.json() as Array<{
      aggregateId: string;
      sequence: number;
      eventType: string;
      payload: unknown;
    }>;
    expect(runtimeEvents.length).toBeGreaterThan(0);
    expect(runtimeEvents[0]).toMatchObject({
      aggregateId: body.graphRunId,
      sequence: 1,
    });
    expect(runtimeEvents[0]).toHaveProperty('payload');

    const db = openMigratedDatabase(join(dataDir, DATABASE_FILE_NAME));
    const snapshot = new WorkflowSnapshotRepository(db).get(body.taskId)!;
    expect(snapshot.source).toBe(source);
    expect(snapshot.semanticHash).toBe(body.semanticHash);
    expect(JSON.parse(snapshot.workflowGraphJson)).toMatchObject({ id: 'cli_smoke' });
    db.close();
  });

  it('fails closed unless uncontracted execution is explicit and source is valid', async () => {
    const { app, repoDir } = await boot();
    const project = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: { path: repoDir },
    });
    const projectId = (project.json() as { id: string }).id;

    const gated = await app.inject({
      method: 'POST',
      url: '/api/runtime/runs',
      headers,
      payload: { projectId, source, brief: 'missing explicit acknowledgement' },
    });
    expect(gated.statusCode).toBe(409);
    expect(gated.json()).toMatchObject({ code: 'CHANGE_CONTRACT_REQUIRED' });

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/runtime/runs',
      headers,
      payload: {
        projectId,
        source: 'workflow broken {',
        brief: 'invalid source',
        allowUncontracted: true,
      },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({ code: 'WORKFLOW_INVALID' });

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/runs/missing',
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/runs/missing/events',
          headers,
        })
      ).statusCode,
    ).toBe(404);
  });
});

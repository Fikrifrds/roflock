import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { authoriseTaskContract } from './contract-fixture.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) await cleanup();
  }
});

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'roleflock-plan-api-data-'));
  const repositoryDir = await mkdtemp(join(tmpdir(), 'roleflock-plan-api-repo-'));
  execFileSync('git', ['init'], { cwd: repositoryDir });
  execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], {
    cwd: repositoryDir,
  });
  execFileSync('git', ['config', 'user.name', 'RoleFlock Test'], {
    cwd: repositoryDir,
  });
  await writeFile(join(repositoryDir, 'README.md'), '# Execution Plan fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repositoryDir });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repositoryDir });

  const session = { token: 'test-token', csrf: 'test-csrf' };
  const server = await createServer({ dataDir, session });
  cleanups.push(async () => {
    await server.app.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(repositoryDir, { recursive: true, force: true });
  });
  const headers = {
    'x-roleflock-token': session.token,
    'x-roleflock-csrf': session.csrf,
    'x-roleflock-actor-id': 'user_fikri',
    'content-type': 'application/json',
  };
  const projectResponse = await server.app.inject({
    method: 'POST',
    url: '/api/projects',
    headers,
    payload: { path: repositoryDir },
  });
  const project = projectResponse.json() as { id: string };
  const taskResponse = await server.app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers,
    payload: {
      projectId: project.id,
      type: 'bug_fix',
      title: 'Idempotent checkout',
      brief: 'Prevent duplicate checkout submissions.',
      risk: 'high',
    },
  });
  const task = taskResponse.json() as { id: string };
  await authoriseTaskContract(server.app, headers, task.id);
  return { app: server.app, headers, task };
}

function proposal(summary = 'Implement checkout idempotency.') {
  return {
    summary,
    assumptions: [],
    steps: [
      {
        id: 'STEP-1',
        objective: 'Implement and verify the requested outcome.',
        criterionIds: ['AC-1'],
        allowedOperations: ['modify_file', 'run_command'],
        expectedFiles: ['src/checkout.ts'],
        completionEvidenceIds: ['E-1'],
      },
    ],
    allowedPaths: ['src'],
    expectedChangedPaths: ['src/checkout.ts'],
    forbiddenPaths: ['infra'],
    dependencyChanges: [],
    migrationActions: [],
    verificationSpecId: 'verification_1',
    repairEnvelope: {
      allowedFailureClasses: ['formatting'],
      maxAttempts: 1,
      mayAddFiles: false,
      mayChangeDependencies: false,
      mayChangePublicApi: false,
      mayChangeSchema: false,
      pathScope: ['src'],
    },
    changeBudget: {
      maxChangedFiles: 2,
      maxAddedLines: 120,
      maxDeletedLines: 80,
      maxNewDependencies: 0,
    },
    decisionLog: [],
  };
}

describe('Execution Plan API', () => {
  it('preserves the exact proposed, approved, deviation, and revised lineage', async () => {
    const { app, headers, task } = await fixture();
    const created = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/execution-plan`,
      headers,
      payload: proposal(),
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers.etag).toBe('"1"');
    const first = created.json() as {
      aggregate: { revision: number };
      plan: { id: string; hash: string; status: string; version: number };
    };
    expect(first).toMatchObject({
      aggregate: { revision: 1 },
      plan: { status: 'proposed', version: 1 },
    });

    const approved = await app.inject({
      method: 'POST',
      url: `/api/execution-plans/${first.plan.id}/approve`,
      headers: { ...headers, 'if-match': '"1"' },
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.headers.etag).toBe('"2"');
    const approvedPlan = approved.json() as {
      plan: { hash: string; status: string; version: number };
    };
    expect(approvedPlan.plan).toMatchObject({ status: 'approved', version: 1 });
    expect(approvedPlan.plan.hash).not.toBe(first.plan.hash);

    const deviation = await app.inject({
      method: 'POST',
      url: `/api/execution-plans/${first.plan.id}/deviations`,
      headers,
      payload: {
        detectedBy: 'executor',
        type: 'scope_expansion',
        evidence: [{ id: 'diff_1', digest: 'b'.repeat(64) }],
        proposedOptions: ['Return to the planner and revise the approved scope.'],
      },
    });
    expect(deviation.statusCode).toBe(201);
    expect(deviation.json()).toMatchObject({
      deviation: {
        planId: first.plan.id,
        planHash: approvedPlan.plan.hash,
        status: 'open',
      },
    });

    const revised = await app.inject({
      method: 'POST',
      url: `/api/execution-plans/${first.plan.id}/revisions`,
      headers: { ...headers, 'if-match': '"2"' },
      payload: {
        ...proposal('Revise checkout idempotency within the newly approved scope.'),
        revisionReason: 'Resolve the reported scope deviation.',
      },
    });
    expect(revised.statusCode).toBe(201);
    expect(revised.headers.etag).toBe('"3"');
    expect(revised.json()).toMatchObject({
      aggregate: { revision: 3, currentVersion: 2 },
      plan: {
        id: first.plan.id,
        status: 'proposed',
        version: 2,
        revisionReason: 'Resolve the reported scope deviation.',
      },
    });

    const stale = await app.inject({
      method: 'POST',
      url: `/api/execution-plans/${first.plan.id}/approve`,
      headers: { ...headers, 'if-match': '"2"' },
      payload: {},
    });
    expect(stale.statusCode).toBe(409);

    const history = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/execution-plan`,
      headers,
    });
    expect(history.statusCode).toBe(200);
    expect(history.headers.etag).toBe('"3"');
    const body = history.json() as {
      snapshots: Array<{ status: string; version: number }>;
      deviations: Array<{ type: string }>;
    };
    expect(body.snapshots.map(({ status, version }) => ({ status, version }))).toEqual([
      { status: 'proposed', version: 1 },
      { status: 'approved', version: 1 },
      { status: 'proposed', version: 2 },
    ]);
    expect(body.deviations).toMatchObject([{ type: 'scope_expansion' }]);
  });
});

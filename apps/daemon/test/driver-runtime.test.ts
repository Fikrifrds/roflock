import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMigratedDatabase } from '@roleflock/database';
import {
  type AgentDriver,
  type AgentRunRequest,
  type DriverCapabilities,
  type ProviderAdapter,
} from '@roleflock/provider-core';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type ServerHandle } from '../src/server.js';
import { ProviderRegistry } from '../src/services/provider-registry.js';
import { authoriseTaskContract } from './contract-fixture.js';

const cleanup: Array<() => Promise<void>> = [];
const INTEGRATION_WAIT_MS = 20_000;
const session = { token: 'test-token', csrf: 'test-csrf' };
const headers = {
  'x-roleflock-token': session.token,
  'x-roleflock-csrf': session.csrf,
  'content-type': 'application/json',
};

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

const driverCapabilities: DriverCapabilities = {
  streaming: true,
  structuredOutput: false,
  workspaceRead: true,
  workspaceWrite: true,
  sessions: true,
  resume: true,
  cancellation: 'remote-confirmed',
  usageReporting: false,
  modelSelection: true,
  effortSelection: false,
  toolEvents: false,
  permissionControls: true,
};

function metadataAdapter(id: string, invoked: () => void): ProviderAdapter {
  return {
    id,
    capabilities: {
      streaming: true,
      tools: false,
      writes: true,
      patches: false,
      headless: true,
      structuredOutput: false,
    },
    async healthCheck() {
      return { status: 'ready' };
    },
    async listModels() {
      return [{ id: 'test-model', displayName: 'Test model' }];
    },
    async *invoke() {
      invoked();
      yield {
        type: 'invocation.failed',
        error: {
          code: 'ADAPTER_CALLED',
          message: 'runtime called ProviderAdapter.invoke instead of AgentDriver',
        },
      };
    },
  };
}

async function boot(driver: AgentDriver, invoked: () => void) {
  const previousForce = process.env.ROFLOCK_FORCE_FAKE;
  process.env.ROFLOCK_FORCE_FAKE = '0';
  const dataDir = await mkdtemp(join(tmpdir(), 'roflock-driver-data-'));
  const repoDir = await mkdtemp(join(tmpdir(), 'roflock-driver-repo-'));
  execFileSync('git', ['init'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'test@roflock.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Roflock'], { cwd: repoDir });
  await writeFile(join(repoDir, 'README.md'), '# fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });

  const providers = new ProviderRegistry();
  providers.registerProvider(metadataAdapter(driver.id, invoked), driver);
  const instance = await createServer({ dataDir, session, providers });
  cleanup.push(async () => {
    await instance.app.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
    if (previousForce === undefined) delete process.env.ROFLOCK_FORCE_FAKE;
    else process.env.ROFLOCK_FORCE_FAKE = previousForce;
  });

  const project = (
    await instance.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: { path: repoDir },
    })
  ).json() as { id: string };
  const role = await instance.app.inject({
    method: 'PUT',
    url: '/api/roles/writer',
    headers,
    payload: { candidates: [{ providerId: driver.id, modelId: 'test-model' }] },
  });
  expect(role.statusCode).toBe(200);
  return { instance, dataDir, projectId: project.id };
}

async function createDirectTask(
  instance: ServerHandle,
  projectId: string,
  verificationCommand: string,
) {
  const response = await instance.app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers,
    payload: {
      projectId,
      type: 'chore',
      mode: 'direct',
      title: 'Driver lifecycle proof',
      brief: 'Exercise the selected driver lifecycle.',
      verificationCommand,
    },
  });
  expect(response.statusCode).toBe(201);
  const task = response.json() as { id: string };
  await authoriseTaskContract(instance.app, headers, task.id);
  return task;
}

async function waitFor(
  instance: ServerHandle,
  path: string,
  predicate: (body: Record<string, unknown>) => boolean,
  timeoutMs = INTEGRATION_WAIT_MS,
) {
  const started = Date.now();
  let last: Record<string, unknown> = {};
  while (Date.now() - started < timeoutMs) {
    const response = await instance.app.inject({ method: 'GET', url: path, headers });
    const body = response.json() as Record<string, unknown>;
    last = body;
    if (predicate(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${path}: ${JSON.stringify(last)}`);
}

describe('production AgentDriver lifecycle', () => {
  it('persists a session and resumes a known later attempt through the driver', async () => {
    let adapterInvocations = 0;
    let starts = 0;
    let resumes = 0;
    const driver: AgentDriver = {
      id: 'session-driver',
      async detect() {
        return { detected: true, authenticated: true };
      },
      async capabilities() {
        return driverCapabilities;
      },
      async models() {
        return [{ id: 'test-model', displayName: 'Test model' }];
      },
      async *start() {
        starts += 1;
        yield { type: 'started', sessionId: 'session_41' };
        yield { type: 'settled', outcome: 'failed', detail: 'planned retry' };
      },
      async *resume(sessionId: string, request: AgentRunRequest) {
        expect(sessionId).toBe('session_41');
        resumes += 1;
        await writeFile(join(request.workspacePath, 'resumed.txt'), 'resumed\n');
        yield { type: 'started', sessionId };
        yield { type: 'settled', outcome: 'completed' };
      },
      async interrupt() {
        return { stopped: true, capability: 'remote-confirmed' };
      },
    };
    const { instance, dataDir, projectId } = await boot(driver, () => (adapterInvocations += 1));
    const task = await createDirectTask(instance, projectId, 'test -f resumed.txt');

    const started = await instance.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/start`,
      headers,
      payload: {},
    });
    expect(started.statusCode).toBe(202);
    const taskState = await waitFor(
      instance,
      `/api/tasks/${task.id}`,
      (body) => body['state'] === 'awaiting_acceptance' || body['state'] === 'failed',
    );
    if (taskState['state'] === 'failed') {
      const evidence = await instance.app.inject({
        method: 'GET',
        url: `/api/evidence/tasks/${task.id}`,
        headers,
      });
      throw new Error(`Driver task failed: ${evidence.body}`);
    }

    expect(starts).toBe(1);
    expect(resumes).toBe(1);
    expect(adapterInvocations).toBe(0);
    const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
    const rows = db
      .prepare(
        `SELECT i.id, i.driver_session_id, i.resumed_from_invocation_id
         FROM invocations i JOIN node_runs nr ON nr.id = i.node_run_id
         WHERE nr.node_key = 'writer' ORDER BY i.started_at`,
      )
      .all() as Array<{
      id: string;
      driver_session_id: string;
      resumed_from_invocation_id?: string;
    }>;
    db.close();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.driver_session_id).toBe('session_41');
    expect(rows[1]?.driver_session_id).toBe('session_41');
    expect(rows[1]?.resumed_from_invocation_id).toBe(rows[0]?.id);
    await instance.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/accept`,
      headers,
      payload: {},
    });
    await waitFor(instance, `/api/tasks/${task.id}`, (body) => body['state'] === 'accepted');
  });

  it('interrupts the selected active driver and returns only its proven guarantee', async () => {
    let adapterInvocations = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    let interrupted = false;
    const driver: AgentDriver = {
      id: 'remote-stop-driver',
      async detect() {
        return { detected: true, authenticated: true };
      },
      async capabilities() {
        return driverCapabilities;
      },
      async *start() {
        yield { type: 'started', sessionId: 'session_stop' };
        await blocked;
        yield { type: 'settled', outcome: 'failed', detail: 'stopped remotely' };
      },
      async *resume() {
        yield { type: 'started', sessionId: 'session_stop' };
        yield { type: 'settled', outcome: 'completed' };
      },
      async interrupt() {
        interrupted = true;
        release();
        return { stopped: true, capability: 'remote-confirmed' };
      },
    };
    const { instance, dataDir, projectId } = await boot(driver, () => (adapterInvocations += 1));
    const task = await createDirectTask(instance, projectId, 'true');
    await instance.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/start`,
      headers,
      payload: {},
    });
    await waitFor(
      instance,
      `/api/tasks/${task.id}/cancellation`,
      (body) => body['activeTurns'] === 1,
    );

    const stopped = await instance.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/stop`,
      headers,
      payload: {},
    });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json()).toMatchObject({
      accepted: true,
      cancellation: {
        capability: 'remote-confirmed',
        confirmable: true,
        stopped: true,
        activeTurns: 1,
      },
    });
    expect(interrupted).toBe(true);
    expect(adapterInvocations).toBe(0);

    const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
    const invocation = db
      .prepare(
        `SELECT cancellation_capability, interruption_json FROM invocations
         WHERE driver_id = 'remote-stop-driver' ORDER BY started_at DESC LIMIT 1`,
      )
      .get() as { cancellation_capability: string; interruption_json: string };
    db.close();
    expect(invocation.cancellation_capability).toBe('remote-confirmed');
    expect(JSON.parse(invocation.interruption_json)).toMatchObject({
      stopped: true,
      capability: 'remote-confirmed',
    });
    await waitFor(instance, `/api/tasks/${task.id}`, (body) => body['state'] === 'cancelled');
  });
});

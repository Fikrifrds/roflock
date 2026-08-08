import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentDriver,
  AgentRunRequest,
  DriverCapabilities,
  ProviderAdapter,
} from '@roleflock/provider-core';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { ProviderRegistry } from '../src/services/provider-registry.js';

const cleanup: Array<() => Promise<void>> = [];
const INTEGRATION_WAIT_MS = 20_000;
const session = { token: 'test-token', csrf: 'test-csrf' };
const headers = {
  'x-roleflock-token': session.token,
  'x-roleflock-csrf': session.csrf,
  'content-type': 'application/json',
};

const source = `workflow portable { version "1.0.0" }
role implementer { write }
agent Build { role implementer objective "Create profile-marker.txt" }
check Verify { run "test -f profile-marker.txt" required }
human Accept
flow { Build -> Verify
       Verify.pass -> Accept }
`;

const capabilities: DriverCapabilities = {
  streaming: true,
  structuredOutput: false,
  workspaceRead: true,
  workspaceWrite: true,
  sessions: false,
  resume: false,
  cancellation: 'local-process',
  usageReporting: false,
  modelSelection: true,
  effortSelection: false,
  toolEvents: false,
  permissionControls: true,
};

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

function adapter(id: string, adapterCalls: string[]): ProviderAdapter {
  return {
    id,
    capabilities: {
      streaming: true,
      tools: false,
      writes: true,
      headless: true,
      structuredOutput: false,
    },
    async healthCheck() {
      return { status: 'ready' };
    },
    async listModels() {
      return [{ id: 'portable-model', displayName: 'Portable model' }];
    },
    async *invoke() {
      adapterCalls.push(id);
      yield {
        type: 'invocation.failed',
        error: { code: 'ADAPTER_CALLED', message: 'Expected AgentDriver.start' },
      };
    },
  };
}

function driver(id: string, requests: AgentRunRequest[]): AgentDriver {
  return {
    id,
    async detect() {
      return { detected: true, authenticated: true };
    },
    async capabilities() {
      return capabilities;
    },
    async models() {
      return [{ id: 'portable-model', displayName: 'Portable model' }];
    },
    async *start(request) {
      requests.push(request);
      await writeFile(join(request.workspacePath, 'profile-marker.txt'), `${id}\n`);
      yield { type: 'started', pid: 4242 };
      yield { type: 'settled', outcome: 'completed' };
    },
    async interrupt() {
      return { stopped: false, capability: 'local-process' };
    },
  };
}

async function waitForTask(
  app: Awaited<ReturnType<typeof createServer>>['app'],
  taskId: string,
  graphRunId: string,
) {
  const started = Date.now();
  let approved = false;
  while (Date.now() - started < INTEGRATION_WAIT_MS) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
      headers,
    });
    const task = response.json() as { state: string };
    if (task.state === 'awaiting_acceptance' || task.state === 'failed') return task;
    if (task.state === 'awaiting_confirmation' && !approved) {
      const pending = await app.inject({
        method: 'GET',
        url: `/api/approvals?runId=${graphRunId}`,
        headers,
      });
      const approvalId = (pending.json() as Array<{ id: string }>)[0]?.id;
      if (approvalId) {
        const decision = await app.inject({
          method: 'POST',
          url: `/api/approvals/${approvalId}/approve`,
          headers,
          payload: {},
        });
        expect(decision.statusCode).toBe(200);
        approved = true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for task ${taskId}`);
}

describe('workflow portability across execution profiles', () => {
  it('runs identical source through two external driver bindings without semantic drift', async () => {
    const previousForce = process.env.ROFLOCK_FORCE_FAKE;
    process.env.ROFLOCK_FORCE_FAKE = '0';
    const dataDir = await mkdtemp(join(tmpdir(), 'roflock-portability-data-'));
    const repoDir = await mkdtemp(join(tmpdir(), 'roflock-portability-repo-'));
    execFileSync('git', ['init'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'portability@roflock.local'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'Roflock Portability'], { cwd: repoDir });
    await writeFile(join(repoDir, 'README.md'), '# portability fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repoDir });

    const alphaRequests: AgentRunRequest[] = [];
    const betaRequests: AgentRunRequest[] = [];
    const adapterCalls: string[] = [];
    const providers = new ProviderRegistry();
    providers.registerProvider(
      adapter('profile-alpha', adapterCalls),
      driver('profile-alpha', alphaRequests),
    );
    providers.registerProvider(
      adapter('profile-beta', adapterCalls),
      driver('profile-beta', betaRequests),
    );
    const instance = await createServer({ dataDir, session, providers });
    cleanup.push(async () => {
      await instance.app.close();
      await rm(dataDir, { recursive: true, force: true });
      await rm(repoDir, { recursive: true, force: true });
      if (previousForce === undefined) delete process.env.ROFLOCK_FORCE_FAKE;
      else process.env.ROFLOCK_FORCE_FAKE = previousForce;
    });

    const project = await instance.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: { path: repoDir },
    });
    const projectId = (project.json() as { id: string }).id;

    const runWithProfile = async (providerId: string) => {
      const binding = await instance.app.inject({
        method: 'PUT',
        url: '/api/roles/writer',
        headers,
        payload: { candidates: [{ providerId, modelId: 'portable-model' }] },
      });
      expect(binding.statusCode).toBe(200);

      const response = await instance.app.inject({
        method: 'POST',
        url: '/api/runtime/runs',
        headers,
        payload: {
          projectId,
          source,
          brief: 'Run the exact portable workflow under the selected external binding',
          allowUncontracted: true,
        },
      });
      expect(response.statusCode).toBe(202);
      const started = response.json() as {
        taskId: string;
        graphRunId: string;
        semanticHash: string;
      };
      const task = await waitForTask(instance.app, started.taskId, started.graphRunId);
      expect(task.state).toBe('awaiting_acceptance');
      return started;
    };

    const alpha = await runWithProfile('profile-alpha');
    const beta = await runWithProfile('profile-beta');

    expect(alpha.semanticHash).toBe(beta.semanticHash);
    expect(alpha.graphRunId).not.toBe(beta.graphRunId);
    expect(alphaRequests).toHaveLength(1);
    expect(betaRequests).toHaveLength(1);
    expect(alphaRequests[0]?.objective).toBe(betaRequests[0]?.objective);
    expect(alphaRequests[0]?.permissions.workspaceWrite).toBe(true);
    expect(betaRequests[0]?.permissions.workspaceWrite).toBe(true);
    expect(adapterCalls).toEqual([]);
  });
});

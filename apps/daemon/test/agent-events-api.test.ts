import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorktreeRepository, openMigratedDatabase } from '@roleflock/database';
import {
  sealAgentEvent,
  type ExternalAgentBinding,
  type UnsealedAgentEvent,
} from '@roleflock/agent-events';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { authoriseTaskContract } from './contract-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe('generic external agent event API', () => {
  it('ingests JSON and JSONL idempotently while rejecting cross-task claims', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'roleflock-agent-events-data-'));
    const repositoryDir = await mkdtemp(join(tmpdir(), 'roleflock-agent-events-repo-'));
    await writeFile(join(repositoryDir, 'README.md'), '# External agent fixture\n');
    initializeRepository(repositoryDir);
    const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryDir,
      encoding: 'utf8',
    }).trim();
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
      'content-type': 'application/json',
    };
    const project = (
      await server.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers,
        payload: { path: repositoryDir },
      })
    ).json() as { id: string };
    const task = (
      await server.app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers,
        payload: {
          projectId: project.id,
          type: 'feature',
          title: 'External event task',
          brief: 'Accept evidence from an external agent.',
        },
      })
    ).json() as { id: string };
    await authoriseTaskContract(server.app, headers, task.id);
    const proposed = await server.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/execution-plan`,
      headers,
      payload: proposal(),
    });
    const proposedPlan = proposed.json() as { plan: { id: string } };
    const approved = await server.app.inject({
      method: 'POST',
      url: `/api/execution-plans/${proposedPlan.plan.id}/approve`,
      headers: { ...headers, 'if-match': '"1"' },
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
    new WorktreeRepository(db).create({
      id: 'worktree_agent_events',
      taskId: task.id,
      projectId: project.id,
      path: repositoryDir,
      branchName: `roleflock/${task.id}`,
      baseCommit,
      status: 'active',
      createdAt: at,
    });
    db.close();

    const bindingResponse = await server.app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/agent-events/binding`,
      headers,
    });
    expect(bindingResponse.statusCode).toBe(200);
    const { actorIdRequirement: _actorIdRequirement, ...bindingFields } =
      bindingResponse.json() as Omit<ExternalAgentBinding, 'actorId'> & {
        actorIdRequirement: string;
      };
    const binding: ExternalAgentBinding = {
      ...bindingFields,
      actorId: 'external_actor_1',
    };
    const codexHook = await server.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/agent-hooks/codex`,
      headers: {
        ...headers,
        'x-roleflock-actor-id': 'codex_actor_1',
        'x-roleflock-installation-id': 'codex_installation_1',
        'x-roleflock-declared-role': 'executor',
      },
      payload: {
        session_id: 'thr_123',
        cwd: repositoryDir,
        hook_event_name: 'SessionStart',
        model: 'gpt-5.6-sol',
        permission_mode: 'default',
        source: 'startup',
      },
    });
    expect(codexHook.statusCode).toBe(200);
    expect(codexHook.json()).toMatchObject({
      status: 'accepted',
      event: {
        source: { agentFamily: 'codex', nativeSessionId: 'thr_123' },
        binding: { taskId: task.id, worktreeId: 'worktree_agent_events' },
      },
    });
    const claudeHook = await server.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/agent-hooks/claude-code`,
      headers: {
        ...headers,
        'x-roleflock-actor-id': 'claude_actor_1',
        'x-roleflock-installation-id': 'claude_installation_1',
        'x-roleflock-declared-role': 'executor',
        'x-roleflock-model-id': 'claude-opus-4-1',
      },
      payload: {
        session_id: 'claude_session_1',
        cwd: repositoryDir,
        permission_mode: 'default',
        hook_event_name: 'SessionStart',
        source: 'startup',
      },
    });
    expect(claudeHook.statusCode).toBe(200);
    expect(claudeHook.json()).toMatchObject({
      status: 'accepted',
      event: {
        source: { agentFamily: 'claude_code', nativeSessionId: 'claude_session_1' },
        binding: { taskId: task.id, worktreeId: 'worktree_agent_events' },
      },
    });
    const started = sealAgentEvent(sourceEvent(binding, 0));
    const accepted = await server.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/agent-events`,
      headers,
      payload: { events: [started] },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ accepted: 1, replayed: 0 });

    const replayed = await server.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/agent-events`,
      headers,
      payload: { events: [started] },
    });
    expect(replayed.json()).toMatchObject({ accepted: 0, replayed: 1 });

    const completed = sealAgentEvent(
      sourceEvent(binding, 1, started.eventHash, {
        type: 'command.completed',
        commandId: 'command_1',
        exitCode: 0,
        durationMs: 25,
        stdoutDigest: '8'.repeat(64),
      }),
    );
    const jsonl = await server.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/agent-events`,
      headers: {
        ...headers,
        'content-type': 'application/x-ndjson',
      },
      payload: `${JSON.stringify(completed)}\n`,
    });
    expect(jsonl.statusCode).toBe(200);
    expect(jsonl.json()).toMatchObject({ accepted: 1, replayed: 0 });

    const crossTask = sealAgentEvent({
      ...sourceEvent({ ...binding, taskId: 'another_task' }, 0),
      eventId: 'cross_task_event',
      source: {
        ...sourceEvent(binding, 0).source,
        nativeSessionId: 'cross_task_session',
        sourceEventId: 'cross_task_source',
      },
    });
    const rejected = await server.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/agent-events`,
      headers,
      payload: { events: [crossTask] },
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toMatchObject({ code: 'TASK_CLAIM_MISMATCH' });
  });
});

function initializeRepository(path: string): void {
  execFileSync('git', ['init'], { cwd: path });
  execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], { cwd: path });
  execFileSync('git', ['config', 'user.name', 'RoleFlock Test'], { cwd: path });
  execFileSync('git', ['add', 'README.md'], { cwd: path });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: path });
}

function sourceEvent(
  binding: ExternalAgentBinding,
  sequence: number,
  previousEventHash?: string,
  payload: UnsealedAgentEvent['payload'] = {
    type: 'session.started',
    interactionMode: 'headless',
    declaredRole: 'executor',
  },
): UnsealedAgentEvent {
  return {
    schemaVersion: 'agent-event-1.0.0',
    eventId: `event_${sequence}`,
    source: {
      agentFamily: 'generic',
      adapterId: 'generic-http',
      adapterVersion: '1.0.0',
      nativeSessionId: 'external_session_1',
      sourceEventId: `source_${sequence}`,
      installationId: 'installation_1',
    },
    binding,
    sequence,
    ...(previousEventHash ? { previousEventHash } : {}),
    occurredAt: `2026-07-28T12:00:0${sequence}.000Z`,
    receivedAt: `2026-07-28T12:00:0${sequence}.100Z`,
    payload,
  };
}

function proposal() {
  return {
    summary: 'Accept external agent evidence.',
    assumptions: [],
    steps: [
      {
        id: 'STEP-1',
        objective: 'Update the requested source.',
        criterionIds: ['AC-1'],
        allowedOperations: ['modify_file'],
        expectedFiles: ['src/external.ts'],
        completionEvidenceIds: ['E-1'],
      },
    ],
    allowedPaths: ['src'],
    expectedChangedPaths: ['src/external.ts'],
    forbiddenPaths: ['infra'],
    dependencyChanges: [],
    migrationActions: [],
    verificationSpecId: 'verification_external',
    repairEnvelope: {
      allowedFailureClasses: [],
      maxAttempts: 0,
      mayAddFiles: false,
      mayChangeDependencies: false,
      mayChangePublicApi: false,
      mayChangeSchema: false,
      pathScope: ['src'],
    },
    changeBudget: {
      maxChangedFiles: 1,
      maxAddedLines: 50,
      maxDeletedLines: 50,
      maxNewDependencies: 0,
    },
    decisionLog: [],
  };
}

const at = '2026-07-28T12:00:00.000Z';

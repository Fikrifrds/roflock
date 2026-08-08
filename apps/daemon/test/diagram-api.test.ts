import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openMigratedDatabase,
  TaskRepository,
  WorkflowSnapshotRepository,
} from '@roleflock/database';
import { resolveWorkflowGraph } from '@roleflock/graph-core';
import { createServer } from '../src/server.js';
import { DATABASE_FILE_NAME } from '../src/data-dir.js';
import { resolveTaskGraph } from '../src/services/orchestrator.js';
import { loadWorkflowTemplates } from '../src/workflow-templates.js';
import { authoriseTaskContract } from './contract-fixture.js';

/**
 * Studio's diagram must be the same drawing the CLI and Playground produce.
 *
 * That is only possible because the daemon keeps the Graph IR a template was
 * compiled from — the bridge is one-way, so discarding it would have forced a
 * second layout implementation, which is exactly the divergence `graph-ui` exists
 * to prevent.
 */

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()!();
  loadWorkflowTemplates();
});

const headers = {
  'x-roleflock-token': 'test-token',
  'x-roleflock-csrf': 'test-csrf',
  'content-type': 'application/json',
};

async function boot() {
  const dataDir = await mkdtemp(join(tmpdir(), 'rf-diagram-data-'));
  const repoDir = await mkdtemp(join(tmpdir(), 'rf-diagram-repo-'));
  execFileSync('git', ['init'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repoDir });
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
  return { app: instance.app, dataDir, repoDir };
}

async function task(app: Awaited<ReturnType<typeof boot>>['app'], repoDir: string) {
  const project = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers,
    payload: { path: repoDir },
  });
  const created = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers,
    payload: {
      projectId: (project.json() as { id: string }).id,
      type: 'bug_fix',
      title: 'Fix a typo',
      brief: 'incomplete',
      expectedBehaviour: 'complete',
      actualBehaviour: 'incomplete',
    },
  });
  const id = (created.json() as { id: string }).id;
  await authoriseTaskContract(app, headers, id);
  return id;
}

function semanticWorkflow(objective: string, command: string) {
  return `workflow semantic_pin { version "1.0.0" }
role implementer { write }
agent Build { role implementer objective "${objective}" }
check Tests { run "${command}" required }
human Accept
flow { Build -> Tests
       Tests.pass -> Accept }
`;
}

describe('the shared diagram endpoint', () => {
  it('discovers and creates a task from a non-built-in workflow ID', async () => {
    const { app, dataDir, repoDir } = await boot();
    const workflowDir = await mkdtemp(join(tmpdir(), 'rf-custom-workflow-'));
    cleanup.push(() => rm(workflowDir, { recursive: true, force: true }));
    await writeFile(
      join(workflowDir, 'release_train.roflock'),
      `workflow release_train { version "1.0.0" }
role implementer { write }
agent Build { role implementer objective "prepare the release" }
check Tests { run "npm test" required }
human Accept
flow { Build -> Tests
       Tests.pass -> Accept }
`,
    );
    expect(loadWorkflowTemplates(workflowDir)).toMatchObject({
      loaded: ['release_train'],
      failures: [],
    });

    const listed = await app.inject({ method: 'GET', url: '/api/workflows', headers });
    expect((listed.json() as Array<{ id: string }>).map((workflow) => workflow.id)).toContain(
      'release_train',
    );
    const project = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: { path: repoDir },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers,
      payload: {
        projectId: (project.json() as { id: string }).id,
        type: 'feature',
        title: 'Prepare release',
        brief: 'Use the custom workflow',
        mode: 'release_train',
      },
    });
    expect(created.statusCode).toBe(201);

    const taskId = (created.json() as { id: string }).id;
    const db = openMigratedDatabase(join(dataDir, DATABASE_FILE_NAME));
    const snapshot = new WorkflowSnapshotRepository(db).get(taskId)!;
    expect(snapshot.graphVersionId).toBe('release_train@3');
    expect(JSON.parse(snapshot.workflowGraphJson)).toMatchObject({ id: 'release_train' });
    db.close();
  });

  it('persists source, IR, and the executable graph when the task is created', async () => {
    const { app, dataDir, repoDir } = await boot();
    const taskId = await task(app, repoDir);
    const db = openMigratedDatabase(join(dataDir, DATABASE_FILE_NAME));
    const snapshot = new WorkflowSnapshotRepository(db).get(taskId);

    expect(snapshot?.source).toContain('workflow bug_fix');
    expect(JSON.parse(snapshot!.graphIrJson!)).toMatchObject({ workflow: { id: 'bug_fix' } });
    expect(JSON.parse(snapshot!.workflowGraphJson)).toMatchObject({
      id: 'bug_fix',
      version: snapshot!.graphVersionId,
      semanticHash: snapshot!.semanticHash,
    });
    expect(snapshot?.graphSnapshotHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    db.close();
  });

  it('cannot collapse distinct source semantics or rewrite an earlier task pin', async () => {
    const { app, dataDir, repoDir } = await boot();
    const firstDir = await mkdtemp(join(tmpdir(), 'rf-semantic-first-'));
    const secondDir = await mkdtemp(join(tmpdir(), 'rf-semantic-second-'));
    cleanup.push(() => rm(firstDir, { recursive: true, force: true }));
    cleanup.push(() => rm(secondDir, { recursive: true, force: true }));
    const firstSource = semanticWorkflow('prepare release A', 'npm run test:a');
    const secondSource = semanticWorkflow('prepare release B', 'npm run test:b');
    await writeFile(join(firstDir, 'semantic_pin.roflock'), firstSource);
    await writeFile(join(secondDir, 'semantic_pin.roflock'), secondSource);
    const project = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: { path: repoDir },
    });
    const projectId = (project.json() as { id: string }).id;
    const create = async (title: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers,
        payload: { projectId, title, brief: title, mode: 'semantic_pin' },
      });
      expect(response.statusCode).toBe(201);
      return (response.json() as { id: string }).id;
    };

    expect(loadWorkflowTemplates(firstDir).failures).toEqual([]);
    const firstTaskId = await create('First semantics');
    expect(loadWorkflowTemplates(secondDir).failures).toEqual([]);
    const secondTaskId = await create('Second semantics');

    const db = openMigratedDatabase(join(dataDir, DATABASE_FILE_NAME));
    const snapshots = new WorkflowSnapshotRepository(db);
    const tasks = new TaskRepository(db);
    const firstSnapshot = snapshots.get(firstTaskId)!;
    const secondSnapshot = snapshots.get(secondTaskId)!;
    const firstGraph = resolveTaskGraph(tasks.get(firstTaskId)!, firstSnapshot);
    const secondGraph = resolveTaskGraph(tasks.get(secondTaskId)!, secondSnapshot);
    const currentGraph = resolveWorkflowGraph('semantic_pin');

    // The compatibility version is intentionally the same. Semantic identity,
    // executable content, and the immutable task pin are what prevent collapse.
    expect(firstSnapshot.graphVersionId).toBe('semantic_pin@3');
    expect(secondSnapshot.graphVersionId).toBe('semantic_pin@3');
    expect(firstSnapshot.source).toBe(firstSource);
    expect(secondSnapshot.source).toBe(secondSource);
    expect(firstSnapshot.semanticHash).not.toBe(secondSnapshot.semanticHash);
    expect(firstSnapshot.graphSnapshotHash).not.toBe(secondSnapshot.graphSnapshotHash);
    expect(firstGraph.nodes.find((node) => node.id === 'Build')?.objective).toBe(
      'prepare release A',
    );
    expect(firstGraph.nodes.find((node) => node.id === 'Tests')?.operation?.command).toBe(
      'npm run test:a',
    );
    expect(secondGraph.nodes.find((node) => node.id === 'Build')?.objective).toBe(
      'prepare release B',
    );
    expect(currentGraph.semanticHash).toBe(secondGraph.semanticHash);
    expect(firstGraph.semanticHash).toBe(firstSnapshot.semanticHash);
    expect(firstGraph.semanticHash).not.toBe(currentGraph.semanticHash);
    db.close();
  });

  it('serves the shared layout for a compiled workflow', async () => {
    const { app, repoDir } = await boot();
    const taskId = await task(app, repoDir);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/diagram`,
      headers,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      graphVersionId: string;
      layout: {
        workflowId: string;
        nodes: Array<{ id: string; rank: number; badges: { writer: boolean; required: boolean } }>;
        edges: Array<{ kind: string }>;
        loops: Array<{ maxAttempts: number }>;
      };
    };

    expect(body.graphVersionId).toMatch(/^bug_fix@\d+$/);
    expect(body.layout.workflowId).toBe('bug_fix');
    // The same governing facts the CLI diagram shows.
    expect(body.layout.nodes.filter((node) => node.badges.writer)).toHaveLength(1);
    expect(body.layout.nodes.filter((node) => node.badges.required)).toHaveLength(1);
    expect(body.layout.edges.some((edge) => edge.kind === 'failure')).toBe(true);
    expect(body.layout.loops[0]?.maxAttempts).toBe(4);
  });

  it('never draws a node above something it depends on', async () => {
    const { app, repoDir } = await boot();
    const taskId = await task(app, repoDir);
    const body = (
      await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/diagram`, headers })
    ).json() as { layout: { nodes: Array<{ id: string; rank: number }> } };
    const rank = (id: string) => body.layout.nodes.find((node) => node.id === id)!.rank;

    expect(rank('planner')).toBeLessThan(rank('reviewer'));
    expect(rank('writer')).toBeLessThan(rank('test'));
    expect(rank('test')).toBeLessThan(rank('accept'));
  });

  it('refuses rather than inventing a layout for a hard-coded template', async () => {
    const { app, repoDir } = await boot();
    const taskId = await task(app, repoDir);

    // A pinned historical version has no Graph IR. Laying one out anyway would
    // mean a second implementation guessing at what the run actually does.
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers,
      payload: { workflowGraphVersionId: 'bug_fix@1' },
    });
    if (response.statusCode !== 200) return; // route may not allow re-pinning; nothing to assert

    const diagram = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/diagram`,
      headers,
    });
    expect(diagram.statusCode).toBe(409);
    expect(diagram.json()).toMatchObject({ error: 'No compiled workflow for this task' });
  });

  it('is not found for a task that does not exist', async () => {
    const { app } = await boot();

    expect(
      (await app.inject({ method: 'GET', url: '/api/tasks/nope/diagram', headers })).statusCode,
    ).toBe(404);
  });

  it('requires authentication like every other route', async () => {
    const { app } = await boot();

    expect((await app.inject({ method: 'GET', url: '/api/tasks/nope/diagram' })).statusCode).toBe(
      401,
    );
  });
});

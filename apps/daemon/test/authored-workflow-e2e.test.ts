import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Task } from '@roleflock/contracts';
import {
  migrate,
  openDatabase,
  TaskRepository,
  WorkflowSnapshotRepository,
} from '@roleflock/database';
import {
  registeredWorkflowIr,
  registeredWorkflowSource,
  resolveWorkflowGraph,
} from '@roleflock/graph-core';
import { resolveTaskGraph } from '../src/services/orchestrator.js';
import {
  backfillWorkflowSnapshots,
  workflowSnapshotRecord,
} from '../src/services/workflow-snapshot.js';
import { loadWorkflowTemplates } from '../src/workflow-templates.js';

/**
 * An edit to a `.roflock` file must reach execution.
 *
 * This is the claim the whole language rests on: the source is not documentation
 * that happens to resemble the runtime graph, it *is* what runs. The two could
 * drift silently — a compiled template that fails to bridge falls back to the
 * hard-coded built-in, which is the right behaviour for robustness and exactly
 * the behaviour that would let an authored change vanish without a word.
 *
 * So the assertion is on a value an author *changed*, read back from the graph
 * the runtime would execute.
 */

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  loadWorkflowTemplates();
  while (cleanup.length > 0) await cleanup.pop()!();
});

async function workflowsDir(source: string) {
  const dir = await mkdtemp(join(tmpdir(), 'rf-authored-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'bug_fix.roflock'), source);
  return dir;
}

/** A minimal but complete workflow: plan, write, check, accept. */
function authored(maxAttempts: number) {
  return `workflow bug_fix {
  version "3.0.0"
  description "Authored in a test"
  max_cost 5
}

role planner {
  readonly
}

role coder {
  write
}

agent plan {
  role planner
  objective "Plan the fix"
}

agent writer {
  role coder
  objective "Implement the fix"
}

check test {
  run "npm test"
  required
}

human accept {
  title "Accept the change"
  decisions approve, reject
}

flow {
  plan -> writer
  writer -> test
  test.pass -> accept
  test.fail -> writer { max ${maxAttempts} }
}
`;
}

describe('a workflow an author edited', () => {
  it('is the graph the runtime would execute, not the built-in', async () => {
    const result = loadWorkflowTemplates(await workflowsDir(authored(3)));
    expect(result.failures).toEqual([]);
    expect(result.loaded).toContain('bug_fix');

    const graph = resolveWorkflowGraph('bug_fix');

    // Nodes the author wrote, not the shipped ones. `planner_tests` and
    // `reviewer` exist in the real bug_fix workflow and deliberately do not
    // appear here, so a fallback to the built-in would fail this.
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(['accept', 'plan', 'test', 'writer']);
  });

  it('carries an edited loop budget through to the runtime graph', async () => {
    loadWorkflowTemplates(await workflowsDir(authored(3)));
    const three = resolveWorkflowGraph('bug_fix').maxLoopIterations;

    loadWorkflowTemplates(await workflowsDir(authored(5)));
    const five = resolveWorkflowGraph('bug_fix').maxLoopIterations;

    // The value the author typed changed the bound the runtime enforces. If the
    // compiler were bypassed anywhere on this path, both reads would be equal.
    expect(five).toBeGreaterThan(three);
    // `max N` counts attempts; re-entries are one fewer.
    expect(three).toBe(2);
    expect(five).toBe(4);
  });

  it('keeps a pinned historical version on the built-in definition', async () => {
    loadWorkflowTemplates(await workflowsDir(authored(3)));

    // A run pinned to a version already executed must keep the semantics it
    // started with; editing the file today cannot rewrite what happened.
    const pinned = resolveWorkflowGraph('bug_fix@1');

    expect(pinned.nodes.map((node) => node.id)).toContain('reviewer');
  });

  it('keeps the exact executable graph after its current template changes', async () => {
    loadWorkflowTemplates(await workflowsDir(authored(3)));
    const graphAtCreation = resolveWorkflowGraph('bug_fix');
    const irAtCreation = registeredWorkflowIr('bug_fix');
    const sourceAtCreation = registeredWorkflowSource('bug_fix');
    expect(irAtCreation).toBeDefined();
    expect(sourceAtCreation).toContain('max 3');

    const task: Task = {
      id: 'task_pinned',
      projectId: 'project_1',
      type: 'bug_fix',
      title: 'Do not rewrite me',
      brief: 'The template will change after creation',
      risk: 'medium',
      state: 'ready',
      workflowGraphVersionId: graphAtCreation.version,
      budgetPolicyId: 'local-default',
      maxAttempts: 3,
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    };
    const snapshot = workflowSnapshotRecord({
      taskId: task.id,
      graph: graphAtCreation,
      ir: irAtCreation!,
      source: sourceAtCreation!,
      createdAt: task.createdAt,
    });

    loadWorkflowTemplates(await workflowsDir(authored(5)));
    expect(resolveWorkflowGraph('bug_fix').maxLoopIterations).toBe(4);

    const pinned = resolveTaskGraph(task, snapshot);
    expect(pinned.maxLoopIterations).toBe(2);
    expect(pinned.semanticHash).toBe(snapshot.semanticHash);
    expect(pinned.semanticHash).not.toBe(resolveWorkflowGraph('bug_fix').semanticHash);
  });

  it('fails closed when a stored executable graph is modified', async () => {
    loadWorkflowTemplates(await workflowsDir(authored(3)));
    const graph = resolveWorkflowGraph('bug_fix');
    const task = {
      id: 'task_corrupt',
      projectId: 'project_1',
      type: 'bug_fix',
      title: 'Reject corruption',
      brief: 'Never fall back to mutable registry state',
      risk: 'medium',
      state: 'ready',
      workflowGraphVersionId: graph.version,
      budgetPolicyId: 'local-default',
      maxAttempts: 3,
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    } satisfies Task;
    const snapshot = workflowSnapshotRecord({
      taskId: task.id,
      graph,
      createdAt: task.createdAt,
    });

    expect(() =>
      resolveTaskGraph(task, {
        ...snapshot,
        workflowGraphJson: snapshot.workflowGraphJson.replace(
          '"maxLoopIterations":2',
          '"maxLoopIterations":99',
        ),
      }),
    ).toThrow('failed its integrity check');
  });

  it('freezes a pre-migration task once during its first upgraded boot', async () => {
    loadWorkflowTemplates(await workflowsDir(authored(3)));
    const db = openDatabase({ path: ':memory:' });
    migrate(db);
    const task = {
      id: 'task_legacy_current',
      projectId: 'project_1',
      type: 'bug_fix',
      title: 'Created before workflow snapshots',
      brief: 'Freeze the last resolvable semantics',
      risk: 'medium',
      state: 'ready',
      workflowGraphVersionId: 'bug_fix@3',
      budgetPolicyId: 'local-default',
      maxAttempts: 3,
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    } satisfies Task;
    new TaskRepository(db).upsert(task);

    expect(backfillWorkflowSnapshots(db, resolveTaskGraph)).toBe(1);
    const snapshot = new WorkflowSnapshotRepository(db).get(task.id)!;
    expect(backfillWorkflowSnapshots(db, resolveTaskGraph)).toBe(0);

    loadWorkflowTemplates(await workflowsDir(authored(5)));
    expect(resolveTaskGraph(task, snapshot).maxLoopIterations).toBe(2);
    expect(resolveWorkflowGraph('bug_fix').maxLoopIterations).toBe(4);
    db.close();
  });
});

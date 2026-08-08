import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveWorkflowGraph } from '@roleflock/graph-core';
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
});

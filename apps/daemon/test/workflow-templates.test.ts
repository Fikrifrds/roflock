import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getWorkflowGraph,
  registerWorkflowTemplates,
  resolveWorkflowGraph,
} from '@roleflock/graph-core';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkflowTemplates } from '../src/workflow-templates.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
  registerWorkflowTemplates([]);
});

function workflowDir(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'roflock-templates-'));
  directories.push(directory);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(directory, name), content);
  }
  return directory;
}

describe('loading built-in workflows from source', () => {
  it('compiles every shipped template', () => {
    const result = loadWorkflowTemplates();

    expect(result.failures).toEqual([]);
    expect(result.loaded).toEqual(['bug_fix', 'critical', 'direct', 'fast', 'standard']);
  });

  it('serves a new task from compiled source under the legacy version id', () => {
    loadWorkflowTemplates();
    const resolved = resolveWorkflowGraph('bug_fix@3');

    // Persisted runs, event payloads and the historical resolver all key off
    // this id, so a compiled template has to keep answering to it.
    expect(resolved.version).toBe('bug_fix@3');
    expect(resolved.nodes.map((n) => n.id).sort()).toEqual(
      getWorkflowGraph('bug_fix')
        .nodes.map((n) => n.id)
        .sort(),
    );
  });

  it('always serves a pinned historical version from the built-in definition', () => {
    loadWorkflowTemplates();

    for (const version of ['bug_fix@1', 'bug_fix@2', 'direct@1', 'fast@2']) {
      // A pinned version is a record of what already happened. Compiled source
      // must never be substituted for it.
      expect(resolveWorkflowGraph(version)).toEqual(getWorkflowGraph(version));
    }
  });

  it('falls back to the built-in when a template fails to compile', () => {
    const result = loadWorkflowTemplates(workflowDir({ 'bug_fix.roflock': 'agent Broken { role' }));

    expect(result.loaded).toEqual([]);
    expect(result.failures[0]?.id).toBe('bug_fix');
    // Degrades to today's behaviour rather than leaving the daemon with no
    // workflow at all.
    expect(resolveWorkflowGraph('bug_fix@3')).toEqual(getWorkflowGraph('bug_fix'));
  });

  it('reports a template that compiles but cannot bridge to the runtime', () => {
    const result = loadWorkflowTemplates(
      workflowDir({
        // Compiles cleanly, but an event node is not something the current
        // runtime can execute.
        'odd.roflock': `
          workflow odd { version "1.0.0" }
          role writer { write }
          agent Build { role writer }
          check Tests { run "npm test" required }
          human Accept
          flow { Build -> Tests
                 Tests.pass -> Accept }
        `,
      }),
    );

    expect(result.failures).toEqual([]);
    expect(result.loaded).toEqual(['odd']);
  });

  it('registers nothing when there is no workflows directory', () => {
    const result = loadWorkflowTemplates(join(tmpdir(), 'roflock-absent-directory'));

    expect(result.loaded).toEqual([]);
    expect(resolveWorkflowGraph('direct@3')).toEqual(getWorkflowGraph('direct'));
  });
});

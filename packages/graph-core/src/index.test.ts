import { describe, expect, it } from 'vitest';
import {
  bugFixGraph,
  criticalGraph,
  directGraph,
  fastGraph,
  getWorkflowGraph,
  recommendWorkflow,
  standardGraph,
  validateGraph,
  type WorkflowGraph,
} from './index.js';

describe('workflow graphs', () => {
  it('validates bug_fix sequence', () => {
    expect(validateGraph(bugFixGraph)).toEqual([]);
    expect(bugFixGraph.nodes.map((node) => node.id)).toEqual([
      'planner',
      'reviewer',
      'writer',
      'test',
      'verifier',
      'accept',
    ]);
  });

  it('exposes direct/fast/standard/critical modes', () => {
    expect(validateGraph(directGraph)).toEqual([]);
    expect(validateGraph(fastGraph)).toEqual([]);
    expect(validateGraph(standardGraph)).toEqual([]);
    expect(validateGraph(criticalGraph)).toEqual([]);
    expect(getWorkflowGraph('direct').nodes.map((n) => n.id)).toEqual([
      'writer',
      'test',
      'accept',
    ]);
    expect(getWorkflowGraph('fast').nodes[0]?.id).toBe('planner');
    expect(getWorkflowGraph('critical').id).toBe('critical');
  });

  it('rejects parallel writers and missing accept', () => {
    const parallel: WorkflowGraph = {
      id: 'direct',
      label: 'bad',
      description: 'bad',
      nodes: [
        { id: 'writer', dependsOn: [] },
        { id: 'writer', dependsOn: [] },
        { id: 'accept', dependsOn: ['writer'] },
      ],
    };
    expect(validateGraph(parallel)).toEqual(
      expect.arrayContaining(['duplicate node id', 'parallel writers are not allowed']),
    );

    const noAccept: WorkflowGraph = {
      id: 'direct',
      label: 'bad',
      description: 'bad',
      nodes: [
        { id: 'writer', dependsOn: [] },
        { id: 'test', dependsOn: ['writer'] },
      ],
    };
    expect(validateGraph(noAccept)).toContain('graph requires a terminal accept node');
  });

  it('recommends smallest sufficient modes from task intent', () => {
    expect(recommendWorkflow({ type: 'bug_fix' }).mode).toBe('bug_fix');
    expect(recommendWorkflow({ type: 'investigation' }).mode).toBe('direct');
    expect(recommendWorkflow({ type: 'feature', risk: 'low' }).mode).toBe('fast');
    expect(recommendWorkflow({ type: 'feature', risk: 'medium' }).mode).toBe('standard');
    expect(recommendWorkflow({ type: 'new_product' }).mode).toBe('critical');
    expect(recommendWorkflow({ type: 'security_fix' }).mode).toBe('critical');
    expect(directGraph.nodes.some((n) => n.id === 'reviewer')).toBe(false);
  });
});

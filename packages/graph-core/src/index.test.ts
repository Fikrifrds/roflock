import { describe, expect, it } from 'vitest';
import {
  bugFixGraph,
  criticalGraph,
  directGraph,
  fastGraph,
  getWorkflowGraph,
  standardGraph,
  validateGraph,
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
});

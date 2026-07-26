import { describe, expect, it } from 'vitest';
import { bugFixGraph, validateGraph } from './index.js';
describe('bug_fix graph', () => {
  it('is valid and preserves the required role sequence', () => {
    expect(validateGraph(bugFixGraph)).toEqual([]);
    expect(bugFixGraph.nodes.map((node) => node.id)).toEqual(['planner', 'reviewer', 'writer', 'test', 'verifier', 'accept']);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeIR, semanticHash, stampSemanticHash, toSemanticIR } from './canonical.js';
import { createGraphIR, defaultOutcomes } from './builder.js';
import type { GraphIR, GraphNode } from './types.js';

function node(id: string, kind: 'agent' | 'human' = 'agent'): GraphNode {
  if (kind === 'human') {
    return {
      id,
      name: id,
      kind: 'human',
      outcomes: [{ id: 'human_approved', terminal: true, accepted: true }],
      human: { requestType: 'approval', title: id, allowedDecisions: ['approve'] },
    } as GraphNode;
  }
  return {
    id,
    name: id,
    kind: 'agent',
    roleRef: 'builder',
    outcomes: defaultOutcomes('agent'),
    agent: { objective: id, mode: 'tool_loop' },
  } as GraphNode;
}

function fixture(overrides: Partial<GraphIR> = {}): GraphIR {
  return createGraphIR({
    workflow: {
      id: 'bugfix',
      name: 'Bug Fix',
      version: '1.0.0',
      entryNodeIds: ['Builder'],
      terminalNodeIds: ['Approval'],
    },
    roles: [{ id: 'builder', name: 'Builder', accessMode: 'write' }],
    nodes: [node('Builder'), node('Approval', 'human')],
    edges: [
      {
        id: 'e1',
        from: { nodeId: 'Builder', outcome: 'completed' },
        to: { nodeId: 'Approval' },
        priority: 0,
      },
    ],
    ...overrides,
  });
}

describe('semantic identity', () => {
  it('is stable across runs', () => {
    expect(semanticHash(fixture())).toBe(semanticHash(fixture()));
  });

  it('is unchanged by declaration order', () => {
    const forward = fixture();
    const reordered: GraphIR = {
      ...forward,
      nodes: [...forward.nodes].reverse(),
      roles: [...forward.roles].reverse(),
    };

    // Two authors who wrote the same workflow in a different order describe the
    // same graph; execution order comes from edges, not from array position.
    expect(semanticHash(reordered)).toBe(semanticHash(forward));
  });

  it('is unchanged by source location, editor layout, or a stale stamped hash', () => {
    const base = fixture();
    const decorated: GraphIR = {
      ...base,
      workflow: {
        ...base.workflow,
        semanticHash: 'sha256:stale',
        source: {
          language: 'roflock',
          languageVersion: '0.1',
          uri: 'file:///somewhere/bugfix.roflock',
          sourceHash: 'sha256:whatever',
        },
      },
      debug: {
        sourceMap: {
          nodes: { Builder: { start: { line: 1, column: 1 }, end: { line: 3, column: 1 } } },
        },
        editorLayout: { Builder: { x: 10, y: 20 } },
      },
    };
    const movedInEditor: GraphIR = {
      ...decorated,
      debug: { ...decorated.debug, editorLayout: { Builder: { x: 999, y: 999 } } },
    };

    // Reformatting a file or dragging a node in Studio must not invalidate the
    // identity a completed run recorded.
    const withSource: GraphIR = {
      ...base,
      workflow: {
        ...base.workflow,
        source: { language: 'roflock', languageVersion: '0.1' },
      },
    };
    expect(semanticHash(decorated)).toBe(semanticHash(withSource));
    expect(semanticHash(movedInEditor)).toBe(semanticHash(decorated));
  });

  it('changes when behaviour changes', () => {
    const base = fixture();
    const rerouted: GraphIR = {
      ...base,
      edges: [
        {
          id: 'e1',
          from: { nodeId: 'Builder', outcome: 'blocked' },
          to: { nodeId: 'Approval' },
          priority: 0,
        },
      ],
    };
    const rebudgeted: GraphIR = {
      ...base,
      policies: { budget: { actualCostLimit: 5, onExceeded: 'fail' } },
    };

    expect(semanticHash(rerouted)).not.toBe(semanticHash(base));
    // Policies constrain legal execution, so they are semantic.
    expect(semanticHash(rebudgeted)).not.toBe(semanticHash(base));
  });

  it('changes when a role capability requirement changes', () => {
    const base = fixture();
    const stricter: GraphIR = {
      ...base,
      roles: [
        {
          id: 'builder',
          name: 'Builder',
          accessMode: 'write',
          requiredCapabilities: ['coding.write'],
        },
      ],
    };

    expect(semanticHash(stricter)).not.toBe(semanticHash(base));
  });

  it('is prefixed with its algorithm', () => {
    expect(semanticHash(fixture())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('normalisation', () => {
  it('sorts sets but preserves arrays whose order carries meaning', () => {
    const base = fixture();
    const multiEntry: GraphIR = {
      ...base,
      workflow: { ...base.workflow, entryNodeIds: ['Builder', 'Approval'] },
      nodes: [node('Approval', 'human'), node('Builder')],
    };
    const normalized = normalizeIR(multiEntry);

    expect(normalized.nodes.map((n) => n.id)).toEqual(['Approval', 'Builder']);
    // Entry sequencing is authored intent, not a set.
    expect(normalized.workflow.entryNodeIds).toEqual(['Builder', 'Approval']);
  });

  it('preserves a node outcome preference order', () => {
    const normalized = normalizeIR(fixture());
    const builder = normalized.nodes.find((n) => n.id === 'Builder')!;

    expect(builder.outcomes.map((o) => o.id)).toEqual([
      'completed',
      'blocked',
      'timeout',
      'provider_unavailable',
    ]);
  });

  it('does not mutate its input', () => {
    const base = fixture();
    const before = JSON.stringify(base);
    normalizeIR(base);
    stampSemanticHash(base);

    expect(JSON.stringify(base)).toBe(before);
  });
});

describe('semantic projection', () => {
  it('drops debug entirely', () => {
    const withDebug: GraphIR = {
      ...fixture(),
      debug: { editorLayout: { Builder: { x: 1, y: 2 } } },
    };

    expect(toSemanticIR(withDebug).debug).toBeUndefined();
  });

  it('stamps a hash that survives a round trip through JSON', () => {
    const stamped = stampSemanticHash(fixture());
    const roundTripped = JSON.parse(JSON.stringify(stamped)) as GraphIR;

    expect(stamped.workflow.semanticHash).toBeDefined();
    // A stored document must re-derive its own identity, or a run could not
    // prove which graph it executed.
    expect(semanticHash(roundTripped)).toBe(stamped.workflow.semanticHash);
  });
});

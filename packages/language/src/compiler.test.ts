import { DiagnosticCode, semanticHash, validateGraphIR } from '@roleflock/graph-ir';
import { describe, expect, it } from 'vitest';
import { compile } from './compiler.js';

/** The RFC-001 §22 worked example, in v0.1 syntax. */
const BUG_FIX = `
# Fix a failing test, with a bounded repair loop.
workflow BugFix {
  version "1.0.0"
  description "Repair a defect and prove it with a deterministic check"
}

role implementer {
  write
  requires "coding.write"
}

role critic {
  readonly
}

agent Builder {
  role implementer
  objective "Implement the smallest safe fix"
}

check Tests {
  run "npm test"
  required
}

agent Reviewer {
  role critic
  objective "Review the change"
}

human Approval {
  title "Accept the fix"
  decisions approve, reject
}

flow {
  Builder -> Tests
  Tests.pass -> Reviewer
  Tests.fail -> Builder { max 3 }
  Reviewer -> Approval
}
`;

function compileOk(source: string) {
  const result = compile(source, { uri: 'test.roflock' });
  if (!result.ir) {
    throw new Error(
      `expected a successful compile, got:\n${result.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n')}`,
    );
  }
  return result.ir;
}

function errorCodes(source: string): string[] {
  return compile(source, { uri: 'test.roflock' })
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.code);
}

describe('compiling .roflock to Graph IR', () => {
  it('lowers the reference bug-fix workflow', () => {
    const ir = compileOk(BUG_FIX);

    expect(ir.workflow.id).toBe('BugFix');
    expect(ir.workflow.version).toBe('1.0.0');
    expect(ir.nodes.map((n) => n.id).sort()).toEqual(['Approval', 'Builder', 'Reviewer', 'Tests']);
    expect(ir.roles.map((r) => r.id).sort()).toEqual(['critic', 'implementer']);
  });

  it('produces IR that passes the independent validator', () => {
    // The compiler already runs the validator, but a document that only its own
    // producer accepts is not a contract.
    expect(validateGraphIR(compileOk(BUG_FIX)).filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('derives outcome contracts from node kind', () => {
    const ir = compileOk(BUG_FIX);
    const outcomes = (id: string) => ir.nodes.find((n) => n.id === id)!.outcomes.map((o) => o.id);

    expect(outcomes('Tests')).toEqual(['pass', 'fail', 'timeout']);
    expect(outcomes('Builder')).toEqual([
      'completed',
      'blocked',
      'timeout',
      'provider_unavailable',
    ]);
    expect(outcomes('Approval')).toEqual(['human_approved', 'human_rejected']);
  });

  it('resolves an unqualified transition to the kind-appropriate outcome', () => {
    const ir = compileOk(BUG_FIX);
    const from = (to: string) => ir.edges.find((e) => e.to.nodeId === to)!.from;

    // `Builder -> Tests` means Builder completing, not Builder doing anything.
    expect(from('Tests')).toEqual({ nodeId: 'Builder', outcome: 'completed' });
    // `Reviewer -> Approval` likewise.
    expect(from('Approval')).toEqual({ nodeId: 'Reviewer', outcome: 'completed' });
  });

  it('derives the entry node from the graph shape', () => {
    expect(compileOk(BUG_FIX).workflow.entryNodeIds).toEqual(['Builder']);
  });

  it('derives a loop group covering the whole cycle, not just the annotated edge', () => {
    const ir = compileOk(BUG_FIX);

    expect(ir.loops).toHaveLength(1);
    const loop = ir.loops[0]!;
    // The author annotated Tests -> Builder; the budget governs both nodes.
    expect([...loop.nodeIds].sort()).toEqual(['Builder', 'Tests']);
    expect(loop.policy.maxAttempts).toBe(3);
    // The verifier is the node whose verdict decides whether to retry.
    expect(loop.policy.verifierNodeId).toBe('Tests');
    expect(loop.policy.requireNewEvidence).toBe(true);
  });

  it('infers the workspace_write effect from a writing role', () => {
    const builder = compileOk(BUG_FIX).nodes.find((n) => n.id === 'Builder')!;

    // Authority is stated once, on the role. Requiring it twice would let the
    // two statements disagree.
    expect(builder.effects).toEqual([{ class: 'workspace_write', risk: 'medium' }]);
  });

  it('defaults to one writer per worktree', () => {
    expect(compileOk(BUG_FIX).policies.concurrency).toEqual({
      oneWriterPerWorkspace: true,
      writerScope: 'worktree',
    });
  });

  it('stamps a semantic hash the document can re-derive', () => {
    const ir = compileOk(BUG_FIX);

    expect(ir.workflow.semanticHash).toBe(semanticHash(ir));
  });

  it('records source provenance without letting it affect semantics', () => {
    const ir = compileOk(BUG_FIX);
    const reformatted = compileOk(BUG_FIX.replace(/\n/g, '\n\n'));

    expect(ir.workflow.source?.language).toBe('roflock');
    expect(ir.workflow.source?.uri).toBe('test.roflock');
    expect(reformatted.workflow.source?.sourceHash).not.toBe(ir.workflow.source?.sourceHash);
    // Whitespace changed the bytes but not the meaning.
    expect(reformatted.workflow.semanticHash).toBe(ir.workflow.semanticHash);
  });

  it('carries source spans for diagnostics but keeps them out of identity', () => {
    const ir = compileOk(BUG_FIX);

    expect(ir.debug?.sourceMap?.nodes?.['Builder']?.start.line).toBeGreaterThan(0);
    expect(ir.debug?.sourceMap?.edges?.['e1']).toBeDefined();
  });

  it('compiles a linear workflow with no loops', () => {
    const ir = compileOk(`
      role writer { write }
      agent Builder { role writer }
      human Approval
      flow { Builder -> Approval }
    `);

    expect(ir.loops).toEqual([]);
    expect(ir.workflow.entryNodeIds).toEqual(['Builder']);
  });
});

describe('compiler diagnostics', () => {
  it('rejects a transition from an outcome the node cannot report', () => {
    const codes = errorCodes(`
      role writer { write }
      agent Builder { role writer }
      human Approval
      flow { Builder.exploded -> Approval }
    `);

    expect(codes).toContain(DiagnosticCode.UnknownOutcome);
  });

  it('points at the offending outcome, not the whole line', () => {
    const result = compile(
      `role writer { write }
agent Builder { role writer }
human Approval
flow { Builder.exploded -> Approval }`,
      { uri: 'test.roflock' },
    );
    const diagnostic = result.diagnostics.find((d) => d.code === DiagnosticCode.UnknownOutcome)!;

    expect(diagnostic.span?.start.line).toBe(4);
    expect(diagnostic.message).toContain('completed');
  });

  it('rejects a reference to a node that was never declared', () => {
    expect(
      errorCodes(`
        role writer { write }
        agent Builder { role writer }
        human Approval
        flow { Builder -> Ghost }
      `),
    ).toContain(DiagnosticCode.UnknownNode);
  });

  it('rejects an agent with no role', () => {
    const codes = errorCodes(`
      agent Builder {}
      human Approval
      flow { Builder -> Approval }
    `);

    // Authority comes from the role, so an agent without one has none.
    expect(codes).toContain(DiagnosticCode.UnknownRole);
  });

  it('rejects a duplicate declaration', () => {
    expect(
      errorCodes(`
        role writer { write }
        agent Builder { role writer }
        agent Builder { role writer }
        human Approval
        flow { Builder -> Approval }
      `),
    ).toContain(DiagnosticCode.DuplicateDeclaration);
  });

  it('rejects a cycle with no retry budget', () => {
    expect(
      errorCodes(`
        role writer { write }
        agent Builder { role writer }
        check Tests { run "npm test" }
        human Approval
        flow {
          Builder -> Tests
          Tests.pass -> Approval
          Tests.fail -> Builder
        }
      `),
    ).toContain(DiagnosticCode.UnboundedCycle);
  });

  it('rejects a retry budget on a transition that closes no cycle', () => {
    expect(
      errorCodes(`
        role writer { write }
        agent Builder { role writer }
        check Tests { run "npm test" }
        human Approval
        flow {
          Builder -> Tests
          Tests.pass -> Approval { max 3 }
        }
      `),
    ).toContain(DiagnosticCode.UnboundedCycle);
  });

  it('rejects non-positive node retry budgets instead of silently ignoring them', () => {
    const agent = errorCodes(`
      role writer { write }
      agent Builder { role writer retry 0 }
      human Approval
      flow { Builder -> Approval }
    `);
    const check = errorCodes(`
      role writer { write }
      agent Builder { role writer }
      check Tests { run "npm test" retry 0 }
      human Approval
      flow {
        Builder -> Tests
        Tests.pass -> Approval
      }
    `);

    expect(agent).toContain(DiagnosticCode.UnboundedCycle);
    expect(check).toContain(DiagnosticCode.UnboundedCycle);
  });

  it('rejects a check with no command', () => {
    expect(
      errorCodes(`
        role writer { write }
        agent Builder { role writer }
        check Tests {}
        human Approval
        flow { Builder -> Tests
               Tests.pass -> Approval }
      `),
    ).toContain(DiagnosticCode.UnknownNode);
  });

  it('rejects an unknown effect class', () => {
    const result = compile(`
      role writer { write }
      agent Builder { role writer effect teleport risk low }
      human Approval
      flow { Builder -> Approval }
    `);

    expect(result.ir).toBeUndefined();
    expect(result.diagnostics.some((d) => d.message.includes('teleport'))).toBe(true);
  });

  it('reports a syntax error with a location and produces no IR', () => {
    const result = compile('agent Builder { role', { uri: 'broken.roflock' });

    expect(result.ir).toBeUndefined();
    expect(result.diagnostics[0]?.severity).toBe('error');
    expect(result.diagnostics[0]?.span?.uri).toBe('broken.roflock');
  });

  it('reports more than one error from a single file', () => {
    const result = compile(`
      nonsense Foo {}
      alsoNonsense Bar {}
    `);

    // Recovering at declaration boundaries means two typos surface together
    // rather than one per edit-compile cycle.
    expect(result.diagnostics.filter((d) => d.severity === 'error').length).toBeGreaterThan(1);
  });

  it('rejects an unterminated string', () => {
    const result = compile('check Tests { run "npm test }');

    expect(result.ir).toBeUndefined();
    expect(result.diagnostics[0]?.message).toContain('Unterminated string');
  });

  it('never returns IR alongside an error', () => {
    const result = compile('agent Builder { role writer }');

    // Half a graph is a graph that quietly means something else.
    expect(result.ir).toBeUndefined();
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});

describe('comments and formatting', () => {
  it('ignores both comment styles and is insensitive to layout', () => {
    const dense = `role w{write}agent B{role w}human A
flow{B -> A}`;
    const spaced = `
      # hash comment
      role w { write }

      // slash comment
      agent B { role w }
      human A

      flow {
        B -> A
      }
    `;

    expect(compileOk(dense).workflow.semanticHash).toBe(compileOk(spaced).workflow.semanticHash);
  });
});

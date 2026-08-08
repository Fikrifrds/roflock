import { graphIrToWorkflowGraph, type WorkflowGraph } from '@roleflock/graph-core';
import { CODING_EXTENSION, validateGraphIR } from '@roleflock/graph-ir';
import { compile } from '@roleflock/language';
import { describe, expect, it } from 'vitest';
import { NodeFailure, runGraph, type NodeContext } from './index.js';

/**
 * R6: roles are arbitrary names, and coding governance survives anyway.
 *
 * Graph IR core knows nothing about verifiers. A workflow may call its roles
 * whatever it likes; the coding runtime's dispatch slots are declared in a
 * namespaced extension, so the two stay separable — which is what lets Roflock
 * run a non-coding workflow without pretending it has a planner.
 */

function build(source: string) {
  const compiled = compile(source, { uri: 'roles.roflock' });
  if (!compiled.ir) {
    throw new Error(
      `compile failed:\n${compiled.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n')}`,
    );
  }
  const bridged = graphIrToWorkflowGraph(compiled.ir);
  if (!bridged.graph) {
    throw new Error(`bridge failed:\n${bridged.diagnostics.map((d) => d.message).join('\n')}`);
  }
  return { ir: compiled.ir, graph: bridged.graph as WorkflowGraph };
}

const CUSTOM_ROLES = `
workflow Bespoke {
  version "1.0.0"
  max_cost 5
}

# Nothing here is called planner, writer or verifier.
role archaeologist { readonly requires "code.read" }
role surgeon { write requires "code.write" }
role adjudicator { readonly dispatch verifier }

agent Investigate { role archaeologist objective "find the cause" }
agent Operate { role surgeon objective "make the change" retry 2 }
check Prove { run "npm test" required }
agent Adjudicate { role adjudicator objective "decide if it holds" reviews }
human Sign

flow {
  Investigate -> Operate
  Operate -> Prove
  Prove.pass -> Adjudicate
  Adjudicate -> Sign
  Prove.fail -> Operate { max 3 }
}
`;

describe('a workflow whose roles are named nothing familiar', () => {
  it('compiles and bridges', () => {
    const { graph } = build(CUSTOM_ROLES);

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'Investigate',
      'Operate',
      'Prove',
      'Adjudicate',
      'Sign',
    ]);
  });

  it('keeps the writer lease on the role that writes, whatever it is called', () => {
    const { graph } = build(CUSTOM_ROLES);

    const writers = graph.nodes.filter((node) => node.writer);
    expect(writers.map((node) => node.id)).toEqual(['Operate']);
  });

  it('keeps the required check unbypassable', () => {
    const { graph } = build(CUSTOM_ROLES);

    expect(graph.nodes.find((node) => node.id === 'Prove')?.required).toBe(true);
    // The legacy validator runs inside the bridge, so reaching a graph at all
    // means acceptance cannot be reached without this check.
    expect(graph.nodes.filter((node) => node.role === 'accept')).toHaveLength(1);
  });

  it('honours a declared dispatch slot over inference', () => {
    const { graph } = build(CUSTOM_ROLES);

    // `adjudicator` declares `dispatch verifier`. Inference would also have said
    // verifier here, so the point is proven by the negative case below.
    expect(graph.nodes.find((node) => node.id === 'Adjudicate')?.role).toBe('verifier');
  });

  it('lets a declaration override what inference would have chosen', () => {
    const { graph } = build(`
      workflow Override { version "1.0.0" }
      role scout { readonly dispatch reviewer }
      role hand { write }
      agent Scout { role scout objective "look around" }
      agent Hand { role hand objective "change it" retry 2 }
      check Prove { run "npm test" required }
      human Sign
      flow {
        Hand -> Prove
        Prove.pass -> Scout
        Scout -> Sign
        Prove.fail -> Hand { max 3 }
      }
    `);

    // Read-only and downstream of a check: inference would call this a
    // verifier. The author said reviewer, and the author wins.
    expect(graph.nodes.find((node) => node.id === 'Scout')?.role).toBe('reviewer');
  });

  it('records dispatch in the coding extension, not in core IR', () => {
    const { ir } = build(CUSTOM_ROLES);

    // Core IR stays domain-neutral: a role is a responsibility, and nothing in
    // it knows what a verifier is.
    expect(ir.roles.every((role) => !('dispatch' in role))).toBe(true);
    expect(ir.extensions?.[CODING_EXTENSION]).toEqual({
      dispatch: { adjudicator: 'verifier' },
    });
  });

  it('is rejected by a host that does not understand the extension', () => {
    const { ir } = build(CUSTOM_ROLES);

    // A host that cannot interpret the coding pack must refuse rather than
    // execute less than the document says.
    const diagnostics = validateGraphIR(ir).filter((d) => d.severity === 'error');
    expect(diagnostics.map((d) => d.code)).toContain('RF801');
    expect(
      validateGraphIR(ir, { supportedExtensions: [CODING_EXTENSION] }).filter(
        (d) => d.severity === 'error',
      ),
    ).toEqual([]);
  });

  it('rejects a dispatch slot that does not exist', () => {
    const result = compile(`
      workflow Bad { version "1.0.0" }
      role odd { readonly dispatch archivist }
      role hand { write }
      agent Odd { role odd }
      agent Hand { role hand }
      human Sign
      flow { Odd -> Hand
             Hand -> Sign }
    `);

    expect(result.ir).toBeUndefined();
    expect(result.diagnostics.some((d) => d.message.includes('archivist'))).toBe(true);
  });

  it('executes end to end with a bounded repair loop', async () => {
    const { graph } = build(CUSTOM_ROLES);
    const runs = new Map<string, number>();

    const execute = async ({ node }: NodeContext) => {
      const count = (runs.get(node.id) ?? 0) + 1;
      runs.set(node.id, count);
      if (node.id === 'Prove' && count === 1) {
        throw new NodeFailure('not yet', 'verification_failed', { repairClass: 'test' });
      }
      return node.id;
    };

    const result = await runGraph(graph, execute, { evaluateEdgeGuard: () => true });

    expect(result.state).toBe('completed');
    expect(result.loopIterations).toBe(1);
    // The surgeon re-ran once and the archaeologist was not dragged back into
    // the loop, because the cycle covers only what the failure route reaches.
    expect(runs.get('Operate')).toBe(2);
    expect(runs.get('Investigate')).toBe(1);
  });
});

describe('coding authority is unaffected by generic roles', () => {
  it('leaves a role ungated unless it declares an authority profile', () => {
    const { graph } = build(CUSTOM_ROLES);

    expect(graph.nodes.every((node) => node.authorityRole === undefined)).toBe(true);
  });

  it('still enforces the artifact gate for a role that opts in', async () => {
    const { graph } = build(`
      workflow Gated { version "1.0.0" }
      role surgeon { write authority executor }
      agent Operate { role surgeon objective "execute the approved plan" retry 2 }
      check Prove { run "npm test" required }
      human Sign
      flow {
        Operate -> Prove
        Prove.pass -> Sign
        Prove.fail -> Operate { max 3 }
      }
    `);

    expect(graph.nodes.find((node) => node.id === 'Operate')?.authorityRole).toBe('executor');
    // A custom role name does not weaken Role Protocol enforcement: the gate
    // still fires before any work is paid for.
    await expect(runGraph(graph, async ({ node }) => node.id)).rejects.toThrow(
      /Artifact gate rejected Operate at start/,
    );
  });
});

import { DiagnosticCode } from '@roleflock/graph-ir';
import { describe, expect, it } from 'vitest';
import { parse } from './parser.js';
import type { SourceFile } from './ast.js';

function parseOk(source: string, uri?: string): SourceFile {
  const result = parse(source, uri);
  if (!result.file) {
    throw new Error(
      `expected a successful parse, got:\n${result.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n')}`,
    );
  }
  return result.file;
}

function errorMessages(source: string): string[] {
  return parse(source)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.message);
}

describe('parsing .roflock declarations', () => {
  it('parses a workflow header with every property', () => {
    const file = parseOk(`
      workflow BugFix {
        version "1.2.3"
        description "What this workflow does"
        max_cost 5
      }
    `);
    const workflow = file.declarations[0];
    expect(workflow).toMatchObject({
      kind: 'workflow',
      name: 'BugFix',
      version: '1.2.3',
      description: 'What this workflow does',
      maxCost: 5,
    });
  });

  it('parses a role with access mode, capabilities, authority, and dispatch', () => {
    const file = parseOk(`
      role implementer {
        write
        requires "coding.write"
        requires "git.push"
        authority role_protocol_writer
        dispatch writer
      }
      role critic { readonly }
    `);
    expect(file.declarations[0]).toMatchObject({
      kind: 'role',
      name: 'implementer',
      accessMode: 'write',
      requires: ['coding.write', 'git.push'],
      authority: 'role_protocol_writer',
      dispatch: 'writer',
    });
    expect(file.declarations[1]).toMatchObject({
      kind: 'role',
      name: 'critic',
      accessMode: 'readonly',
      requires: [],
    });
  });

  it('parses an agent with ports, effects, reviews, and retry', () => {
    const file = parseOk(`
      agent Verifier {
        role critic
        objective "Judge the change"
        consumes plan
        consumes diff
        produces verdict
        effect network_access risk high
        effect git_push
        reviews
        retry 2
      }
    `);
    expect(file.declarations[0]).toMatchObject({
      kind: 'agent',
      name: 'Verifier',
      role: 'critic',
      objective: 'Judge the change',
      consumes: ['plan', 'diff'],
      produces: ['verdict'],
      effects: [
        { effect: 'network_access', risk: 'high' },
        { effect: 'git_push', risk: 'medium' },
      ],
      reviews: true,
      retry: 2,
    });
  });

  it('defaults an effect to medium risk and marks required checks', () => {
    const file = parseOk(`
      check Tests {
        run "npm test"
        required
      }
    `);
    expect(file.declarations[0]).toMatchObject({
      kind: 'check',
      name: 'Tests',
      run: 'npm test',
      required: true,
      consumes: [],
      produces: [],
    });
  });

  it('parses an action and a bare artifact', () => {
    const file = parseOk(`
      artifact verdict
      action Deploy {
        run "./deploy.sh"
        effect deploy risk critical
      }
    `);
    expect(file.declarations[0]).toMatchObject({ kind: 'artifact', name: 'verdict' });
    expect(file.declarations[1]).toMatchObject({
      kind: 'action',
      name: 'Deploy',
      run: './deploy.sh',
      effects: [{ effect: 'deploy', risk: 'critical' }],
    });
  });

  it('parses a human gate with a comma-separated decision list', () => {
    const file = parseOk(`
      human Accept {
        title "Accept the verified change"
        decisions approve, reject, escalate
      }
    `);
    expect(file.declarations[0]).toMatchObject({
      kind: 'human',
      name: 'Accept',
      title: 'Accept the verified change',
      decisions: ['approve', 'reject', 'escalate'],
    });
  });

  it('accepts declaration keywords as node names in position', () => {
    const file = parseOk(`
      role r { readonly }
      check check { run "x" }
      agent flow { role r }
      human human { title "t" }
      flow { }
    `);
    expect(file.declarations.map((d) => (d as { name: string }).name)).toEqual([
      'r',
      'check',
      'flow',
      'human',
    ]);
  });

  it('treats a property block as optional', () => {
    const file = parseOk('artifact bare');
    expect(file.declarations[0]).toMatchObject({ kind: 'artifact', name: 'bare' });
  });
});

describe('parsing flows', () => {
  it('parses named and anonymous flows with qualified outcomes and budgets', () => {
    const file = parseOk(`
      flow main {
        Planner -> Writer
        Tests.fail -> Planner { max 4 }
      }
      flow { Writer -> Tests }
    `);
    const [named, anonymous] = file.flows;
    expect(named).toMatchObject({ kind: 'flow', name: 'main' });
    expect(named?.transitions[0]).toMatchObject({ from: 'Planner', to: 'Writer' });
    expect(named?.transitions[1]).toMatchObject({
      from: 'Tests',
      fromOutcome: 'fail',
      to: 'Planner',
      max: 4,
    });
    expect(anonymous?.name).toBeUndefined();
    expect(anonymous?.transitions).toHaveLength(1);
  });

  it('records a separate span for the qualified outcome', () => {
    const file = parseOk('flow { Tests.fail -> Writer }', 'f.roflock');
    const transition = file.flows[0]?.transitions[0];
    expect(transition?.fromOutcomeSpan?.uri).toBe('f.roflock');
    expect(transition?.fromOutcomeSpan?.start.column).toBe(14);
  });

  it('keeps declaration order in spans', () => {
    const file = parseOk('role a { readonly }\nrole b { readonly }');
    expect(file.declarations[0]?.span.start.line).toBe(1);
    expect(file.declarations[1]?.span.start.line).toBe(2);
  });
});

describe('parser diagnostics', () => {
  it('rejects an unknown declaration with the expected keywords listed', () => {
    const messages = errorMessages('nonsense Foo {}');
    expect(messages[0]).toContain("'nonsense'");
    expect(messages[0]).toContain('workflow, role, artifact, agent, check, action, human, flow');
  });

  it('rejects unknown properties per declaration kind', () => {
    expect(errorMessages('workflow w { colour "red" }')[0]).toContain(
      "Unknown workflow property 'colour'",
    );
    expect(errorMessages('role r { writes }')[0]).toContain("Unknown role property 'writes'");
    expect(errorMessages('agent a { hat "large" }')[0]).toContain("Unknown agent property 'hat'");
    expect(errorMessages('check c { skip }')[0]).toContain("Unknown check property 'skip'");
    expect(errorMessages('action a { jump }')[0]).toContain("Unknown action property 'jump'");
    expect(errorMessages('human h { greeting "hi" }')[0]).toContain(
      "Unknown human property 'greeting'",
    );
    expect(errorMessages('flow { a -> b { budget 3 } }')[0]).toContain(
      "Unknown transition property 'budget'",
    );
  });

  it('reports syntax errors under RF110, not the node-reference code', () => {
    const result = parse('agent Builder { role');
    expect(result.file).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe(DiagnosticCode.SyntaxError);
  });

  it('rejects a transition that is missing its arrow', () => {
    expect(errorMessages('flow { a b }')[0]).toContain('Expected -> between two nodes');
  });

  it('rejects a missing block terminator at end of file', () => {
    expect(errorMessages('role r { readonly').some((m) => m.includes('Unterminated block'))).toBe(
      true,
    );
    expect(errorMessages('flow { a -> b').some((m) => m.includes('Unterminated flow'))).toBe(true);
  });

  it('rejects a string where an identifier is required, and vice versa', () => {
    expect(errorMessages('role "quoted" { readonly }')[0]).toContain('a role name');
    expect(errorMessages('workflow w { version 3 }')[0]).toContain('a version string');
  });

  it('rejects unknown effect classes and risk levels', () => {
    expect(errorMessages('action a { effect teleport }')[0]).toContain(
      "Unknown effect class 'teleport'",
    );
    expect(errorMessages('action a { effect deploy risk extreme }')[0]).toContain(
      "Unknown risk level 'extreme'",
    );
  });

  it('rejects a transition budget stated twice', () => {
    const messages = errorMessages('flow { a -> b { max 2 max 9 } }');
    expect(messages.some((m) => m.includes("'max' more than once"))).toBe(true);
  });

  it('surfaces tokenizer errors as located diagnostics', () => {
    const result = parse('check Tests { run "npm test }');
    expect(result.file).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe(DiagnosticCode.SyntaxError);
    expect(result.diagnostics[0]?.message).toContain('Unterminated string');
  });

  it('recovers at declaration boundaries so several errors surface together', () => {
    const messages = errorMessages(`
      nonsense Foo {}
      role "quoted" { readonly }
      agent a { hat "large" }
    `);
    expect(messages.length).toBeGreaterThanOrEqual(3);
  });

  it('yields no AST whenever any error was recorded', () => {
    // Half a graph is a graph that quietly means something else.
    const result = parse('role r { readonly }\nnonsense X {}');
    expect(result.file).toBeUndefined();
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('quotes string tokens in errors using source-escapable text', () => {
    // The decoded value contains a real quote; the message must show text the
    // author can find in their file, not the decoded value.
    const message = errorMessages('role "say \\"hi\\"" { readonly }')[0];
    expect(message).toContain('Expected a role name, found string "say \\"hi\\""');
  });
});

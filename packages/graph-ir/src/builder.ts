import {
  IR_KIND,
  IR_VERSION,
  type GraphIR,
  type NodeKind,
  type OutcomeDefinition,
  type WorkflowIdentity,
} from './types.js';

/**
 * The outcomes a node kind reports unless the author declares otherwise.
 *
 * These exist so a workflow author does not have to enumerate failure modes
 * that every node of that kind can produce anyway. They are *contract*, not
 * convenience: an agent can only report `blocked`, `timeout` or
 * `provider_unavailable` because they are listed here, and a graph that wants
 * to route those cases must draw an edge from one of them.
 */
export function defaultOutcomes(kind: NodeKind): OutcomeDefinition[] {
  switch (kind) {
    case 'agent':
      return [
        { id: 'completed' },
        { id: 'blocked' },
        { id: 'timeout' },
        { id: 'provider_unavailable' },
      ];
    case 'model_call':
      return [{ id: 'completed' }, { id: 'timeout' }, { id: 'provider_unavailable' }];
    case 'check':
      // A check's whole purpose is a deterministic verdict, so pass and fail are
      // separate outcomes rather than one `completed` carrying a payload.
      return [{ id: 'pass' }, { id: 'fail' }, { id: 'timeout' }];
    case 'action':
      return [{ id: 'completed' }, { id: 'fail' }, { id: 'timeout' }];
    case 'human':
      return [
        { id: 'human_approved' },
        { id: 'human_rejected', terminal: true },
        { id: 'changes' },
      ];
    case 'route':
    case 'join':
    case 'context':
    case 'evidence':
    case 'event':
      return [{ id: 'completed' }];
  }
}

export interface CreateGraphIRInput extends Partial<Omit<GraphIR, 'irVersion' | 'kind'>> {
  workflow: WorkflowIdentity;
}

/** Builds a complete document from the parts a caller cares about. */
export function createGraphIR(input: CreateGraphIRInput): GraphIR {
  return {
    irVersion: IR_VERSION,
    kind: IR_KIND,
    workflow: input.workflow,
    goals: input.goals ?? [],
    artifacts: input.artifacts ?? [],
    roles: input.roles ?? [],
    nodes: input.nodes ?? [],
    edges: input.edges ?? [],
    loops: input.loops ?? [],
    policies: input.policies ?? {},
    profiles: input.profiles ?? [],
    ...(input.extensions ? { extensions: input.extensions } : {}),
    ...(input.debug ? { debug: input.debug } : {}),
  };
}

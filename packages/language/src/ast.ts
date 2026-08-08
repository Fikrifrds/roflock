import type { EffectClass, RiskClass, SourceSpan } from '@roleflock/graph-ir';

/**
 * `.roflock` AST — v0.1, pending RFC-002.
 *
 * The AST preserves author intent and source spans; it is deliberately *not*
 * Graph IR. The compiler derives things the author did not write — entry nodes,
 * loop groups, default outcomes — and an AST that already carried them could
 * not report a useful error about what the author actually typed.
 */

export interface Node {
  span: SourceSpan;
}

export interface WorkflowDecl extends Node {
  kind: 'workflow';
  name: string;
  version?: string;
  description?: string;
  /** `max_cost N` — the run's actual-cost ceiling, in whole currency units. */
  maxCost?: number;
}

export interface RoleDecl extends Node {
  kind: 'role';
  name: string;
  accessMode?: 'readonly' | 'write';
  requires: string[];
  /**
   * `authority <profile>` — binds this role to an enforced authority profile,
   * such as a Role Protocol role with artifact gates. Always explicit: a role
   * must never acquire enforcement by being named a certain way.
   */
  authority?: string;
}

export interface ArtifactDecl extends Node {
  kind: 'artifact';
  name: string;
}

export interface EffectDecl extends Node {
  effect: EffectClass;
  risk: RiskClass;
}

export interface AgentDecl extends Node {
  kind: 'agent';
  name: string;
  role?: string;
  objective?: string;
  consumes: string[];
  produces: string[];
  effects: EffectDecl[];
  /** `reviews` — this agent may return work for changes, not just complete. */
  reviews: boolean;
  /** `retry N` — bounded retries of this node's *own* failure. */
  retry?: number;
}

export interface CheckDecl extends Node {
  kind: 'check';
  name: string;
  run?: string;
  required: boolean;
  consumes: string[];
  produces: string[];
  /** `retry N` — bounded retries of this node's *own* failure. */
  retry?: number;
}

export interface ActionDecl extends Node {
  kind: 'action';
  name: string;
  run?: string;
  effects: EffectDecl[];
}

export interface HumanDecl extends Node {
  kind: 'human';
  name: string;
  title?: string;
  decisions: string[];
}

export type Declaration =
  WorkflowDecl | RoleDecl | ArtifactDecl | AgentDecl | CheckDecl | ActionDecl | HumanDecl;

export interface Transition extends Node {
  from: string;
  /** Absent means "the node's primary outcome"; the compiler resolves it. */
  fromOutcome?: string;
  fromOutcomeSpan?: SourceSpan;
  to: string;
  /** `{ max N }` — a bounded retry the compiler lowers into a loop group. */
  max?: number;
}

export interface FlowDecl extends Node {
  kind: 'flow';
  name?: string;
  transitions: Transition[];
}

export interface SourceFile extends Node {
  declarations: Declaration[];
  flows: FlowDecl[];
  uri?: string;
}

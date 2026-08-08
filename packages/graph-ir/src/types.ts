/**
 * Roflock Graph IR v1 — the canonical semantic representation every authoring
 * surface lowers into and the runtime executes from. See RFC-001.
 *
 * Two rules shape everything here:
 *
 * - Graph IR says **what may run and how control can move**. It never holds
 *   run state. Attempts, outcomes, leases and approvals are runtime records
 *   that *reference* these ids; nothing in this file is mutable during a run.
 * - Control stays outside agents. A node declares the outcomes it may report,
 *   and edges are drawn from those declarations, so a model can pick among
 *   outcomes but can never invent an edge, extend a budget, or grant itself a
 *   permission.
 */

export const IR_VERSION = '1.0';
export const IR_KIND = 'roflock.graph';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonSchema = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Workflow identity
// ---------------------------------------------------------------------------

export interface WorkflowSource {
  language: 'roflock';
  languageVersion: string;
  /** Non-semantic: excluded from the semantic hash. */
  uri?: string;
  /** Non-semantic: describes the source bytes, not the meaning. */
  sourceHash?: string;
}

export interface WorkflowIdentity {
  id: string;
  name: string;
  /** Changes when semantic behaviour changes; independent of `irVersion`. */
  version: string;
  description?: string;
  entryNodeIds: string[];
  terminalNodeIds: string[];
  tags?: string[];
  taskTypes?: string[];
  source?: WorkflowSource;
  /** Set by {@link stampSemanticHash}; excluded from its own computation. */
  semanticHash?: string;
}

// ---------------------------------------------------------------------------
// Goals and acceptance
// ---------------------------------------------------------------------------

export type RiskClass = 'low' | 'medium' | 'high' | 'critical';

export interface AcceptanceCriterion {
  id: string;
  statement: string;
  /** A blocking criterion must resolve to evidence before an accepted terminal. */
  blocking: boolean;
  verifier: { nodeId: string; outcome?: string; artifactType?: string };
}

export interface Goal {
  id: string;
  objective: string;
  riskClass: RiskClass;
  prohibitedOutcomes?: string[];
  outOfScope?: string[];
  criteria: AcceptanceCriterion[];
}

// ---------------------------------------------------------------------------
// Artifacts and ports
// ---------------------------------------------------------------------------

export type Confidentiality = 'public' | 'internal' | 'confidential' | 'secret';
export type Retention = 'ephemeral' | 'run' | 'project' | 'persistent';

export interface ArtifactType {
  id: string;
  name: string;
  schema?: JsonSchema;
  mediaType?: string;
  confidentiality?: Confidentiality;
  retention?: Retention;
}

export interface Port {
  name: string;
  artifactType: string;
  required: boolean;
  cardinality: 'one' | 'many';
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export interface RoleIndependence {
  fromRoleIds?: string[];
  fromNodeIds?: string[];
  requireDifferentProvider?: boolean;
  requireFreshSession?: boolean;
}

/**
 * A stable responsibility and capability requirement. Deliberately does not
 * name a model or a vendor — that binding lives in an {@link ExecutionProfile},
 * so the same workflow runs against a different harness without a semantic
 * change.
 */
export interface RoleDefinition {
  id: string;
  name: string;
  description?: string;
  requiredCapabilities?: string[];
  preferredCapabilities?: string[];
  accessMode?: 'readonly' | 'write';
  permissionProfileRef?: string;
  independence?: RoleIndependence;
}

export interface ExecutionProfile {
  id: string;
  name: string;
  bindings: Array<{
    roleId: string;
    driver: string;
    provider?: string;
    model?: string;
    accountRef?: string;
  }>;
  fallbackPolicy?: 'none' | 'compatible' | 'approval_required';
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export type EffectClass =
  | 'workspace_write'
  | 'dependency_change'
  | 'network_access'
  | 'database_write'
  | 'external_side_effect'
  | 'secret_access'
  | 'git_push'
  | 'merge'
  | 'deploy'
  | 'production_access'
  | 'payment_mutation'
  | 'public_publish'
  | 'destructive';

export interface EffectDeclaration {
  class: EffectClass;
  scope?: string[];
  risk: RiskClass;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export type NodeKind =
  | 'agent'
  | 'model_call'
  | 'action'
  | 'check'
  | 'route'
  | 'join'
  | 'human'
  | 'event'
  | 'context'
  | 'evidence';

/**
 * An outcome a node is contractually allowed to report. Edges may only be drawn
 * from a declared outcome, which is what keeps routing out of a model's hands.
 */
export interface OutcomeDefinition {
  id: string;
  terminal?: boolean;
  /** Terminal outcome that counts as success. Only meaningful when terminal. */
  accepted?: boolean;
  evidenceRequired?: boolean;
  payloadSchema?: JsonSchema;
}

export interface NodeTimeout {
  durationMs: number;
  onTimeout: 'fail' | 'pause' | 'route';
  outcome?: string;
}

export interface NodeBase {
  id: string;
  name: string;
  kind: NodeKind;
  description?: string;
  inputs?: Port[];
  outputs?: Port[];
  outcomes: OutcomeDefinition[];
  roleRef?: string;
  permissionProfileRef?: string;
  timeout?: NodeTimeout;
  effects?: EffectDeclaration[];
  annotations?: Record<string, string>;
}

export interface AgentNode extends NodeBase {
  kind: 'agent';
  roleRef: string;
  agent: {
    objective: string;
    mode: 'tool_loop';
    contextPolicyRef?: string;
    structuredOutputSchema?: JsonSchema;
  };
}

export interface ModelCallNode extends NodeBase {
  kind: 'model_call';
  modelCall: { objective: string; outputSchema: JsonSchema };
}

export interface ActionNode extends NodeBase {
  kind: 'action';
  action: {
    driver: 'command' | 'git' | 'http' | 'connector' | 'domain';
    operation: string;
    args?: Record<string, JsonValue>;
  };
}

export interface CheckNode extends NodeBase {
  kind: 'check';
  check: {
    driver: 'command' | 'test' | 'schema' | 'assertion' | 'domain';
    operation: string;
    args?: Record<string, JsonValue>;
    /** A required check must pass on every path to an accepted terminal. */
    required?: boolean;
  };
}

export interface RouteNode extends NodeBase {
  kind: 'route';
  route: {
    selector: {
      source: 'artifact' | 'state' | 'budget' | 'quota' | 'policy';
      ref: string;
      path?: string;
    };
  };
}

export interface JoinNode extends NodeBase {
  kind: 'join';
  join: {
    strategy: 'all' | 'all_successful' | 'quorum';
    requiredNodeIds: string[];
    quorum?: number;
    preserveDisagreement: boolean;
  };
}

export interface HumanNode extends NodeBase {
  kind: 'human';
  human: {
    requestType: 'approval' | 'clarification' | 'decision';
    title: string;
    requiredArtifactTypes?: string[];
    allowedDecisions: string[];
  };
}

export interface EventNode extends NodeBase {
  kind: 'event';
  event: { eventType: string; payloadSchema?: JsonSchema };
}

export interface ContextNode extends NodeBase {
  kind: 'context';
  context: { policyRef?: string };
}

export interface EvidenceNode extends NodeBase {
  kind: 'evidence';
  evidence: { bundle?: string };
}

export type GraphNode =
  | AgentNode
  | ModelCallNode
  | ActionNode
  | CheckNode
  | RouteNode
  | JoinNode
  | HumanNode
  | EventNode
  | ContextNode
  | EvidenceNode;

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/** No arbitrary expressions in v1: guards stay statically decidable. */
export type EdgeGuard =
  | { type: 'always' }
  | { type: 'outcome'; equals: string }
  | { type: 'value'; sourceRef: string; path?: string; equals: JsonValue }
  | { type: 'policy'; policyRef: string; result: string };

export interface GraphEdge {
  id: string;
  from: { nodeId: string; outcome: string };
  to: { nodeId: string; input?: string };
  /** Lower wins when several edges are eligible. */
  priority: number;
  handoff?: Array<{ artifactType: string; fromPort?: string; toPort?: string }>;
  guard?: EdgeGuard;
}

// ---------------------------------------------------------------------------
// Loops
// ---------------------------------------------------------------------------

export type LoopExhaustion =
  { action: 'fail' } | { action: 'pause' } | { action: 'route'; nodeId: string };

export interface LoopGroup {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
  policy: {
    objective: string;
    /** The node whose verdict decides whether another attempt is warranted. */
    verifierNodeId: string;
    maxAttempts: number;
    maxDurationMs?: number;
    maxActualCost?: number;
    maxShadowCost?: number;
    /** Refuse a retry that would run against unchanged evidence. */
    requireNewEvidence: boolean;
    exhaustion: LoopExhaustion;
  };
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export interface BudgetPolicy {
  actualCostLimit?: number;
  shadowCostLimit?: number;
  warningAtPercent?: number;
  onExceeded: 'fail' | 'pause' | 'approval';
}

export interface ConcurrencyPolicy {
  maxParallelNodes?: number;
  oneWriterPerWorkspace: boolean;
  writerScope: 'worktree' | 'repository' | 'project';
}

export interface ApprovalPolicy {
  protectedEffects: EffectClass[];
  reusableGrantMaxRisk?: 'low' | 'medium' | 'high';
  alwaysFreshEffects?: EffectClass[];
}

export interface SecurityPolicy {
  denyUndeclaredNetwork: boolean;
  denyUndeclaredSecrets: boolean;
  denyDynamicCodeExecution?: boolean;
}

export interface QuotaPolicy {
  maxInvocations?: number;
  maxTokens?: number;
}

export interface WorkflowPolicies {
  budget?: BudgetPolicy;
  quota?: QuotaPolicy;
  concurrency?: ConcurrencyPolicy;
  approval?: ApprovalPolicy;
  security?: SecurityPolicy;
}

// ---------------------------------------------------------------------------
// Debug / source map
// ---------------------------------------------------------------------------

export interface SourcePosition {
  line: number;
  column: number;
  offset?: number;
}

export interface SourceSpan {
  uri?: string;
  start: SourcePosition;
  end: SourcePosition;
}

/** Diagnostics only. Excluded from the semantic hash by definition. */
export interface DebugInfo {
  sourceMap?: {
    nodes?: Record<string, SourceSpan>;
    edges?: Record<string, SourceSpan>;
    roles?: Record<string, SourceSpan>;
    artifacts?: Record<string, SourceSpan>;
    loops?: Record<string, SourceSpan>;
  };
  editorLayout?: Record<string, { x: number; y: number }>;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export interface GraphIR {
  irVersion: string;
  kind: typeof IR_KIND;
  workflow: WorkflowIdentity;
  goals: Goal[];
  artifacts: ArtifactType[];
  roles: RoleDefinition[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  loops: LoopGroup[];
  policies: WorkflowPolicies;
  profiles: ExecutionProfile[];
  /** Namespaced. An unknown *required* extension must be rejected, not ignored. */
  extensions?: Record<string, JsonValue>;
  debug?: DebugInfo;
}

/** Outcome ids the runtime and compiler both understand without declaration. */
export const WELL_KNOWN_OUTCOMES = {
  completed: 'completed',
  pass: 'pass',
  fail: 'fail',
  approve: 'approve',
  changes: 'changes',
  blocked: 'blocked',
  timeout: 'timeout',
  providerUnavailable: 'provider_unavailable',
  budgetExceeded: 'budget_exceeded',
  humanApproved: 'human_approved',
  humanRejected: 'human_rejected',
} as const;

/**
 * The coding pack's extension namespace.
 *
 * Graph IR core is domain-neutral: a role is a stable responsibility, and
 * nothing in it knows what a "verifier" is. Coding-specific conventions —
 * which legacy dispatch slot a role fills — belong in a namespaced extension,
 * where a host that does not understand them must refuse the document rather
 * than quietly execute less than it says.
 */
export const CODING_EXTENSION = 'roflock.coding/v1';

/** Legacy dispatch slots the coding runtime switches on. */
export type CodingDispatch = 'planner' | 'reviewer' | 'writer' | 'test' | 'verifier' | 'accept';

export interface CodingExtension {
  /** Role id → the dispatch slot it fills. Declared, never inferred. */
  dispatch?: Record<string, CodingDispatch>;
}

/** Effects that may never run without an approval path reaching them. */
export const DEFAULT_PROTECTED_EFFECTS: readonly EffectClass[] = [
  'git_push',
  'merge',
  'deploy',
  'production_access',
  'payment_mutation',
  'public_publish',
  'destructive',
];

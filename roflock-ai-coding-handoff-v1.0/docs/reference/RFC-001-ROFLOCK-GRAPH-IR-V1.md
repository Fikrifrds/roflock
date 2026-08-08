# RFC-001 — Roflock Graph IR v1

**Status:** Proposed / implementation baseline  
**Version:** 1.0-draft  
**Date:** 7 August 2026  
**Scope:** Canonical intermediate representation between Roflock authoring frontends and the Roflock runtime

---

## 1. Decision

Roflock SHALL introduce a canonical, provider-neutral, runtime-neutral intermediate representation named **Roflock Graph IR**.

All executable workflows MUST be lowered into Graph IR before execution.

```text
.roflock source ─┐
                 │
Visual Studio ───┼──► Graph IR v1 ───► Runtime
                 │
AI generation ───┤
                 │
SDK / API ───────┘
```

Graph IR is the contract between:

- the Roflock Language toolchain;
- visual authoring;
- AI-assisted workflow generation;
- SDK/API clients;
- graph validation;
- execution planning;
- the durable runtime.

The runtime MUST NOT depend on `.roflock` source syntax.

The language compiler MUST NOT depend on runtime storage, daemon process layout, SQLite, provider subprocesses, or UI state.

---

## 2. Why Graph IR exists

Without a canonical IR, every frontend would need to know runtime internals and every runtime change could leak into the language.

Graph IR gives Roflock five important properties:

1. **Language independence** — `.roflock`, visual authoring, SDKs and future importers target the same representation.
2. **Provider independence** — workflows describe required capabilities and role bindings without encoding one agent vendor as the execution model.
3. **Runtime independence** — local SQLite execution, remote runners, or a future durable execution backend can consume the same workflow definition.
4. **Reproducibility** — a run can store the exact semantic IR hash that was executed.
5. **Static analysis** — the compiler can validate graph safety before any model, command, network call or external side effect runs.

---

## 3. Non-goals

Graph IR v1 is NOT:

- a general-purpose programming language;
- an event log;
- a mutable runtime state snapshot;
- a provider transcript format;
- a UI layout format;
- a prompt format;
- a database schema;
- a replacement for domain packs;
- a free-form expression language.

Runtime state, run events, process handles, leases, invocation data, usage ledgers and approvals are separate runtime records that reference immutable Graph IR entities.

---

## 4. Core invariants

A conforming Graph IR v1 document MUST satisfy the following invariants.

### 4.1 Immutable definition during a run

Once a run starts, its semantic Graph IR is immutable.

A workflow edit produces a new IR hash and therefore a new graph version.

### 4.2 Stable semantic identity

The runtime stores:

```text
irVersion
workflow.id
workflow.version
semanticHash
sourceHash (when source exists)
```

`semanticHash` is computed from canonical semantic IR and excludes non-semantic metadata such as editor layout and source locations.

### 4.3 Control remains outside agents

Agent/model outputs may select only outcomes declared by their node contract.

They cannot:

- add arbitrary edges;
- extend their own retry limits;
- extend budgets;
- grant permissions;
- skip required checks;
- bypass human approval;
- mutate Graph IR during execution.

### 4.4 Every executable path is statically resolvable

Every referenced node, artifact type, role, policy and outcome must resolve at compile time.

### 4.5 Every cycle is governed

Every reachable directed cycle MUST belong to a declared loop group with a bounded loop policy.

### 4.6 Side effects are explicit

Nodes that can perform protected external side effects MUST declare the effect class and MUST satisfy applicable approval policy.

### 4.7 Runtime state is separate

Graph IR says **what may run and how control can move**.

Runtime state says **what is happening or happened in a specific run**.

---

## 5. Top-level structure

A Graph IR v1 document has this conceptual shape:

```json
{
  "irVersion": "1.0",
  "kind": "roflock.graph",
  "workflow": {},
  "goals": [],
  "artifacts": [],
  "roles": [],
  "nodes": [],
  "edges": [],
  "loops": [],
  "policies": {},
  "profiles": [],
  "extensions": {},
  "debug": {}
}
```

Only `debug` is explicitly non-semantic.

`extensions` are semantic unless an extension declares itself otherwise.

---

## 6. Workflow identity

```ts
interface WorkflowIdentity {
  id: string;
  name: string;
  version: string;
  description?: string;
  entryNodeIds: string[];
  terminalNodeIds: string[];
  tags?: string[];
  taskTypes?: string[];
  source?: {
    language: "roflock";
    languageVersion: string;
    uri?: string;
    sourceHash?: string;
  };
  semanticHash?: string;
}
```

### Rules

- `id` MUST remain stable across non-breaking edits when the author intends the workflow to remain the same logical workflow.
- `version` MUST change when semantic behavior changes.
- `entryNodeIds` MUST reference existing nodes.
- `terminalNodeIds` MUST reference existing terminal-capable nodes.
- At least one terminal must be reachable from every entry path unless that path intentionally ends in a declared blocked/cancelled terminal outcome.

---

## 7. Goals and acceptance criteria

Goals define what successful completion means.

```ts
interface Goal {
  id: string;
  objective: string;
  riskClass: "low" | "medium" | "high" | "critical";
  prohibitedOutcomes?: string[];
  outOfScope?: string[];
  criteria: AcceptanceCriterion[];
}

interface AcceptanceCriterion {
  id: string;
  statement: string;
  blocking: boolean;
  verifier: {
    nodeId: string;
    outcome?: string;
    artifactType?: string;
  };
}
```

A run is not accepted merely because the last node completed.

A blocking criterion must resolve to valid evidence before the workflow can enter an accepted terminal state.

---

## 8. Artifact type system

Artifacts formalize handoffs between nodes.

```ts
interface ArtifactType {
  id: string;
  name: string;
  schema?: JsonSchema;
  mediaType?: string;
  confidentiality?: "public" | "internal" | "confidential" | "secret";
  retention?: "ephemeral" | "run" | "project" | "persistent";
}
```

Node ports reference artifact types.

```ts
interface Port {
  name: string;
  artifactType: string;
  required: boolean;
  cardinality: "one" | "many";
}
```

Example:

```text
Architect produces Plan
Builder consumes Plan and produces Patch
Tests consume Patch and produce TestReport
Reviewer consumes Patch + TestReport and produces ReviewReport
```

### Artifact compile checks

The compiler MUST detect:

- required input with no reachable producer;
- unknown artifact type;
- incompatible port type;
- invalid cardinality;
- producer only reachable after consumer;
- ambiguous required producer where policy forbids ambiguity.

---

## 9. Roles

A role describes a stable responsibility and capability requirement.

```ts
interface RoleDefinition {
  id: string;
  name: string;
  description?: string;

  requiredCapabilities?: string[];
  preferredCapabilities?: string[];

  accessMode?: "readonly" | "write";

  permissionProfileRef?: string;

  independence?: {
    fromRoleIds?: string[];
    fromNodeIds?: string[];
    requireDifferentProvider?: boolean;
    requireFreshSession?: boolean;
  };
}
```

Roles do NOT identify a specific model.

Provider/model binding belongs to execution profiles or user configuration.

---

## 10. Execution profiles

Profiles resolve role/capability requirements to concrete drivers/providers/models.

```ts
interface ExecutionProfile {
  id: string;
  name: string;

  bindings: Array<{
    roleId: string;
    driver: string;
    provider?: string;
    model?: string;
    accountRef?: string;
  }>;

  fallbackPolicy?: "none" | "compatible" | "approval_required";
}
```

Profiles may vary without changing graph control semantics.

Examples:

```text
quality
economical
local
enterprise-approved
```

A profile may be selected when a run starts.

---

## 11. Node model

Graph IR v1 defines the following canonical node kinds:

```ts
type NodeKind =
  | "agent"
  | "model_call"
  | "action"
  | "check"
  | "route"
  | "join"
  | "human"
  | "event"
  | "context"
  | "evidence";
```

These are canonical IR kinds.

The public `.roflock` language may expose a smaller or friendlier set.

### 11.1 Common node fields

```ts
interface NodeBase {
  id: string;
  name: string;
  kind: NodeKind;
  description?: string;

  inputs?: Port[];
  outputs?: Port[];

  outcomes: OutcomeDefinition[];

  roleRef?: string;
  permissionProfileRef?: string;

  timeout?: {
    durationMs: number;
    onTimeout: "fail" | "pause" | "route";
    outcome?: string;
  };

  effects?: EffectDeclaration[];

  annotations?: Record<string, string>;
}
```

### 11.2 Outcomes

```ts
interface OutcomeDefinition {
  id: string;
  terminal?: boolean;
  evidenceRequired?: boolean;
  payloadSchema?: JsonSchema;
}
```

Typical outcomes include:

```text
completed
pass
fail
approve
changes
blocked
timeout
provider_unavailable
quota_low
budget_exceeded
human_approved
human_rejected
```

Outcomes are node contracts, not free-form model prose.

### 11.3 Agent node

```ts
interface AgentNode extends NodeBase {
  kind: "agent";
  roleRef: string;

  agent: {
    objective: string;
    mode: "tool_loop";
    contextPolicyRef?: string;
    structuredOutputSchema?: JsonSchema;
  };
}
```

### 11.4 Model-call node

A bounded single structured model request without an autonomous tool loop.

```ts
interface ModelCallNode extends NodeBase {
  kind: "model_call";
  roleRef?: string;

  modelCall: {
    objective: string;
    outputSchema: JsonSchema;
  };
}
```

### 11.5 Action node

A deterministic predefined operation.

```ts
interface ActionNode extends NodeBase {
  kind: "action";

  action: {
    driver: "command" | "git" | "http" | "connector" | "domain";
    operation: string;
    args?: Record<string, unknown>;
  };
}
```

### 11.6 Check node

```ts
interface CheckNode extends NodeBase {
  kind: "check";

  check: {
    driver: "command" | "test" | "schema" | "assertion" | "domain";
    operation: string;
    args?: Record<string, unknown>;
  };
}
```

A check MUST produce a deterministic or structurally validated outcome.

### 11.7 Route node

Routes using durable structured state.

Graph IR v1 deliberately avoids an unrestricted expression language.

```ts
interface RouteNode extends NodeBase {
  kind: "route";

  route: {
    selector: {
      source: "artifact" | "state" | "budget" | "quota" | "policy";
      ref: string;
      path?: string;
    };
  };
}
```

Edges from a route node define allowed values/outcomes.

### 11.8 Join node

```ts
interface JoinNode extends NodeBase {
  kind: "join";

  join: {
    strategy: "all" | "all_successful" | "quorum";
    requiredNodeIds: string[];
    quorum?: number;
    preserveDisagreement: boolean;
  };
}
```

### 11.9 Human node

```ts
interface HumanNode extends NodeBase {
  kind: "human";

  human: {
    requestType: "approval" | "clarification" | "decision";
    title: string;
    requiredArtifactTypes?: string[];
    allowedDecisions: string[];
  };
}
```

Human decisions are durable graph outcomes.

### 11.10 Event node

An entry/resume event.

```ts
interface EventNode extends NodeBase {
  kind: "event";

  event: {
    eventType: string;
    payloadSchema?: JsonSchema;
  };
}
```

---

## 12. Effects

Protected side effects are declared statically.

```ts
type EffectClass =
  | "workspace_write"
  | "dependency_change"
  | "network_access"
  | "database_write"
  | "external_side_effect"
  | "secret_access"
  | "git_push"
  | "merge"
  | "deploy"
  | "production_access"
  | "payment_mutation"
  | "public_publish"
  | "destructive";

interface EffectDeclaration {
  class: EffectClass;
  scope?: string[];
  risk: "low" | "medium" | "high" | "critical";
}
```

Compiler/policy validation determines whether a protected effect has an adequate approval path.

---

## 13. Edges

Edges connect a specific outcome of one node to another node.

```ts
interface GraphEdge {
  id: string;

  from: {
    nodeId: string;
    outcome: string;
  };

  to: {
    nodeId: string;
    input?: string;
  };

  priority: number;

  handoff?: Array<{
    artifactType: string;
    fromPort?: string;
    toPort?: string;
  }>;

  guard?: EdgeGuard;
}
```

### 13.1 Edge guards

Graph IR v1 permits only restricted declarative guards.

```ts
type EdgeGuard =
  | { type: "always" }
  | { type: "outcome"; equals: string }
  | { type: "value"; sourceRef: string; path?: string; equals: JsonValue }
  | { type: "policy"; policyRef: string; result: string };
```

No arbitrary JavaScript/Python expression is allowed in v1 IR.

This improves deterministic validation, portability and security.

---

## 14. Loop groups

Cycles are represented explicitly after graph analysis.

```ts
interface LoopGroup {
  id: string;
  nodeIds: string[];
  edgeIds: string[];

  policy: {
    objective: string;
    verifierNodeId: string;

    maxAttempts: number;
    maxDurationMs: number;

    maxActualCost?: number;
    maxShadowCost?: number;

    requireNewEvidence: boolean;

    exhaustion:
      | { action: "fail" }
      | { action: "pause" }
      | { action: "route"; nodeId: string };
  };
}
```

### Compiler requirement

Every reachable strongly connected component containing a cycle MUST resolve to exactly one compatible loop policy or to a set of explicitly nested loop groups.

The compiler rejects an unbounded cycle.

---

## 15. Policies

Policies are part of semantic IR because they constrain legal execution.

```ts
interface WorkflowPolicies {
  budget?: BudgetPolicy;
  quota?: QuotaPolicy;
  concurrency?: ConcurrencyPolicy;
  approval?: ApprovalPolicy;
  security?: SecurityPolicy;
}
```

### 15.1 Budget policy

```ts
interface BudgetPolicy {
  actualCostLimit?: number;
  shadowCostLimit?: number;
  warningAtPercent?: number;

  onExceeded:
    | "fail"
    | "pause"
    | "approval";
}
```

### 15.2 Concurrency policy

```ts
interface ConcurrencyPolicy {
  maxParallelNodes?: number;
  oneWriterPerWorkspace: boolean;
  writerScope: "worktree" | "repository" | "project";
}
```

For the coding pack, `oneWriterPerWorkspace` SHOULD default to true.

### 15.3 Approval policy

```ts
interface ApprovalPolicy {
  protectedEffects: EffectClass[];
  reusableGrantMaxRisk?: "low" | "medium" | "high";
  alwaysFreshEffects?: EffectClass[];
}
```

### 15.4 Security policy

```ts
interface SecurityPolicy {
  denyUndeclaredNetwork: boolean;
  denyUndeclaredSecrets: boolean;
  denyDynamicCodeExecution?: boolean;
}
```

---

## 16. Debug/source map

Source locations are useful for diagnostics but do not change execution semantics.

```ts
interface DebugInfo {
  sourceMap?: {
    nodes?: Record<string, SourceSpan>;
    edges?: Record<string, SourceSpan>;
    roles?: Record<string, SourceSpan>;
    artifacts?: Record<string, SourceSpan>;
    loops?: Record<string, SourceSpan>;
  };

  editorLayout?: Record<string, {
    x: number;
    y: number;
  }>;
}

interface SourceSpan {
  uri?: string;
  start: { line: number; column: number; offset?: number };
  end: { line: number; column: number; offset?: number };
}
```

`debug` MUST be excluded from `semanticHash`.

---

## 17. Canonical hashing

Roflock stores two hashes when source exists.

### `sourceHash`

Hash of normalized source bytes.

Used for:

- source-change detection;
- editor synchronization;
- provenance.

### `semanticHash`

Hash of canonical semantic Graph IR.

Excluded from canonical hash:

- `debug`;
- `workflow.source.uri`;
- `workflow.source.sourceHash`;
- `workflow.semanticHash`;
- timestamps;
- editor layout;
- presentation-only labels explicitly marked non-semantic.

Recommended algorithm for v1:

```text
SHA-256(canonical-json(semantic-ir))
```

Canonical JSON MUST use:

- UTF-8;
- deterministic object-key ordering;
- deterministic array ordering where order is declared non-semantic;
- no insignificant whitespace;
- normalized numbers;
- explicit null policy.

Exact canonicalization rules should be frozen before public compatibility is promised.

---

## 18. Compiler passes

The `.roflock` compiler SHOULD use explicit passes.

```text
Source
  ↓
1. Parse
  ↓
AST
  ↓
2. Name resolution
  ↓
3. Type / artifact checking
  ↓
4. Outcome validation
  ↓
5. Graph construction
  ↓
6. Reachability analysis
  ↓
7. Cycle / SCC analysis
  ↓
8. Loop policy validation
  ↓
9. Concurrency / writer analysis
  ↓
10. Effect / approval analysis
  ↓
11. Goal / evidence validation
  ↓
12. Capability/profile validation
  ↓
13. Lowering
  ↓
Graph IR
  ↓
14. Canonicalization + hash
```

The compiler MUST fail closed for errors affecting execution safety.

Warnings may be emitted for quality concerns that do not make the workflow invalid.

---

## 19. Diagnostic model

Diagnostics should be stable enough for IDE tooling and tests.

```ts
interface Diagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  span?: SourceSpan;
  related?: Array<{
    message: string;
    span?: SourceSpan;
  }>;
  fix?: {
    title: string;
    replacement?: string;
  };
}
```

Initial diagnostic namespace:

```text
RF1xx  names / references / syntax-semantic boundary
RF2xx  graph / reachability / loops
RF3xx  concurrency / writer safety
RF4xx  role / independence / provider capability
RF5xx  effects / approvals / permissions
RF6xx  budget / quota / limits
RF7xx  artifacts / evidence / acceptance criteria
RF8xx  package / extension / compatibility
```

Suggested initial diagnostics:

```text
RF101 Unknown node
RF102 Unknown role
RF103 Duplicate declaration
RF121 Unknown outcome
RF201 Unreachable node
RF202 Missing terminal
RF210 Unbounded cycle
RF211 Loop verifier unreachable
RF212 Retry without new evidence
RF301 Concurrent writers
RF401 Reviewer independence weakened
RF410 Missing required capability
RF501 Protected effect without approval path
RF502 Undeclared network access
RF503 Undeclared secret access
RF601 Missing cost boundary
RF701 Missing artifact producer
RF702 Artifact type mismatch
RF710 Blocking criterion has no verifier
```

---

## 20. Runtime boundary

Graph IR does not contain mutable run state.

A runtime creates records similar to:

```text
GraphRun
NodeRun
LoopAttempt
Session
Invocation
Event
ArtifactInstance
TestRun
ReviewFinding
ConfirmationRequest
Approval
ControlCommand
RuntimeLease
ProcessHandle
ExecutionSnapshot
UsageLedgerEntry
```

Every runtime record references immutable IR entities using stable IDs and the graph semantic hash.

Suggested runtime identity tuple:

```text
run_id
+ semantic_hash
+ node_id
+ attempt
```

The existing stable invocation concept:

```text
task_id + graph_version + node_id + attempt
```

can evolve to include `semanticHash` so that a paid invocation is never confused across graph changes.

---

## 21. Event model compatibility

Execution remains event-sourced.

Graph IR defines legal transitions.

Runtime events record actual transitions.

Example:

```json
{
  "eventId": "evt_01",
  "runId": "run_42",
  "semanticHash": "sha256:...",
  "type": "node.outcome",
  "nodeId": "Tests",
  "attempt": 1,
  "timestamp": "2026-08-07T10:00:00+07:00",
  "payload": {
    "outcome": "fail",
    "selectedEdgeId": "edge_tests_fail_builder",
    "evidenceRefs": ["artifact:test-report:1"]
  }
}
```

The reducer checks that:

- the node exists in IR;
- the outcome is declared;
- the selected edge is legal;
- loop policy permits another attempt;
- policy still permits transition.

---

## 22. Source-to-IR lowering example

Source:

```roflock
agent Builder {
  role implementer
  write
}

check Tests {
  run "npm test"
}

agent Reviewer {
  role reviewer
  readonly
}

human Approval

flow BugFix {
  Builder -> Tests
  Tests.pass -> Reviewer
  Tests.fail -> Builder { max 3 }
  Reviewer.approve -> Approval
}
```

Conceptual lowering:

```text
Builder
  kind = agent
  outcomes = [completed, blocked, timeout, provider_unavailable]

Tests
  kind = check
  outcomes = [pass, fail, timeout]

Reviewer
  kind = agent
  outcomes = [approve, changes, blocked, timeout]

Approval
  kind = human
  outcomes = [human_approved, human_rejected]
```

The compiler discovers the strongly connected component:

```text
Builder -> Tests -> Builder
```

and emits one loop group with:

```text
maxAttempts = 3
verifierNodeId = Tests
requireNewEvidence = true
```

---

## 23. Example normalized IR

See:

```text
examples/bugfix.ir.json
```

The example demonstrates:

- workflow identity;
- roles;
- nodes;
- typed outcomes;
- deterministic test;
- explicit edges;
- compiler-generated loop group;
- one-writer policy;
- human approval;
- source map boundary.

---

## 24. Visual editor contract

The visual editor MUST edit the semantic graph model, not store an opaque independent workflow.

Recommended rule:

```text
.roflock source
      ↕
AST / semantic model
      ↕
Graph IR
      ↕
Visual projection
```

Editor layout belongs in `debug.editorLayout` or a sidecar.

Semantic changes in the canvas must round-trip to source.

Pure layout changes must not alter `semanticHash`.

---

## 25. AI-generated workflow contract

AI-generated workflows do not receive special execution privileges.

Required path:

```text
Natural language
      ↓
LLM-generated .roflock or AST
      ↓
Compiler
      ↓
Static validation
      ↓
Graph IR
      ↓
Policy validation
      ↓
Execution
```

The system MUST NOT execute an LLM-generated arbitrary graph before compiler and policy validation succeed.

---

## 26. Extension model

Graph IR v1 supports namespaced extensions:

```json
{
  "extensions": {
    "roflock.coding/v1": {},
    "vendor.example/custom/v1": {}
  }
}
```

Rules:

- extension keys MUST be globally namespaced;
- unknown required extensions cause compilation/runtime rejection;
- optional extensions may be ignored only when declared non-semantic;
- core runtimes MUST not silently reinterpret unknown extension fields;
- domain packs SHOULD prefer typed artifact schemas and registered operations over arbitrary executable code.

---

## 27. Compatibility

### IR version

```text
irVersion = MAJOR.MINOR
```

- MAJOR change: incompatible semantic/schema change.
- MINOR change: backward-compatible additions.

Runtime behavior:

- same major, supported minor: accept;
- newer unsupported minor: accept only if all used capabilities are understood;
- different major: reject unless an explicit migration exists.

### Workflow version

Independent from IR version.

A workflow can move from:

```text
workflow version 1.4 -> 1.5
```

while remaining on:

```text
Graph IR 1.0
```

---

## 28. Security properties

Graph IR enables security controls that are difficult with free-form agent prompts.

It makes statically visible:

- which nodes can write;
- which nodes can access network;
- which nodes can touch secrets;
- which nodes can deploy;
- which paths reach protected effects;
- which paths cross human approvals;
- where model judgement controls routing;
- which loops consume repeated model calls;
- which reviewers are independent;
- which artifacts leave a confidentiality boundary.

A future `roflock audit` command can analyze these properties without executing the workflow.

---

## 29. CLI contract enabled by Graph IR

Initial commands:

```bash
roflock parse workflow.roflock
roflock check workflow.roflock
roflock compile workflow.roflock -o workflow.ir.json
roflock render workflow.roflock
roflock simulate workflow.roflock
roflock audit workflow.roflock
roflock run workflow.roflock
```

Debug commands:

```bash
roflock inspect-ir workflow.ir.json
roflock hash workflow.roflock
```

---

## 30. Package/module recommendation

Add the following packages to the existing monorepo:

```text
packages/
├── language-core/          # AST, source spans, diagnostics
├── language-parser/        # .roflock parser
├── language-compiler/      # resolution, analysis, lowering
├── graph-ir/               # canonical Graph IR types + JSON Schema
├── language-formatter/     # canonical source formatter
└── language-lsp/           # later: Language Server Protocol
```

Existing packages remain:

```text
graph-core
graph-runtime
provider-core
approval-engine
policy-engine
repository-runtime
command-runner
context-compiler
usage-ledger
```

Recommended dependency direction:

```text
language-parser
      ↓
language-core
      ↓
language-compiler ─────► graph-ir
                           ↓
                       graph-core
                           ↓
                       graph-runtime
```

Runtime packages MUST NOT import parser packages.

---

## 31. Implementation sequence

### IR-01 — Freeze Graph IR interfaces

Deliver:

- TypeScript interfaces;
- JSON Schema;
- canonical node kinds;
- edge/outcome contract;
- loop group contract;
- policy contract.

### IR-02 — Build invariant validator

Given Graph IR JSON, validate:

- schema;
- references;
- reachability;
- terminals;
- cycles;
- loop groups;
- one writer;
- effects/approval paths;
- acceptance criteria.

This is useful even before `.roflock` parsing exists.

### IR-03 — Define AST separately

The AST should preserve author intent, comments and source spans.

Do not reuse Graph IR as AST.

### IR-04 — Implement parser

Parse `.roflock` into AST.

### IR-05 — Implement compiler passes

Lower AST to Graph IR.

### IR-06 — Integrate existing graph runtime

Add adapter:

```text
Graph IR -> existing graph-core/runtime definitions
```

Prefer migrating graph-core to consume Graph IR types directly if this can be done without coupling runtime state into IR.

### IR-07 — Add formatter and diagnostics

Required before public language release.

### IR-08 — Add Studio round-trip

Only after the source/AST/IR boundaries are stable.

---

## 32. Acceptance tests for Graph IR v1

The Graph IR package is not complete until these fixtures pass.

### Valid

1. Linear `A -> B -> C`.
2. Check with pass/fail branches.
3. Bounded Builder/Test loop.
4. Parallel read-only reviewers and join.
5. Human approval before protected deploy.
6. Event-triggered non-coding workflow.
7. Role profile swapped without graph semantic change where bindings are external.
8. Artifact chain Plan -> Patch -> TestReport -> Review.

### Invalid

1. Unknown node.
2. Unknown outcome.
3. Unreachable required node.
4. Missing terminal.
5. Unbounded cycle.
6. Cycle with unreachable verifier.
7. Two concurrent writers to one worktree.
8. Deploy path without approval.
9. Required artifact with no producer.
10. Blocking acceptance criterion without verifier.
11. Agent requests undeclared secret access.
12. Unsupported required extension.

---

## 33. Decisions intentionally deferred

RFC-001 does not freeze:

- exact `.roflock` grammar;
- parser technology;
- source formatter style;
- arbitrary data expression syntax;
- package registry format;
- domain-pack manifest;
- secret value representation;
- distributed execution protocol;
- visual graph layout algorithm;
- multi-repository transaction semantics;
- remote human approval protocol;
- full formal type inference.

These are separate RFCs.

---

## 34. Next RFC

After this RFC is accepted, the next document should be:

> **RFC-002 — Roflock Language v0.1 Grammar, AST & Compiler Semantics**

RFC-002 should define:

- lexical rules;
- declarations;
- flow syntax;
- outcomes;
- bounded retries;
- roles;
- artifacts;
- goals;
- imports;
- profiles;
- comments;
- source spans;
- AST;
- compiler lowering rules;
- diagnostics with concrete source examples.

---

## 35. Final architecture

```text
                     Authoring
                        │
        ┌───────────────┼────────────────┐
        │               │                │
   .roflock         Visual Studio      SDK / AI
        │               │                │
        └───────────────┬┴────────────────┘
                        ▼
              Language / Authoring Model
                        │
                        ▼
                Semantic Compiler
                        │
                        ▼
                 GRAPH IR v1
              immutable + hashed
                        │
          ┌─────────────┼──────────────┐
          ▼             ▼              ▼
      Validator       Renderer        Audit
          │
          ▼
      Graph Runtime
          │
 ┌────────┼────────┬──────────┬───────────┐
 ▼        ▼        ▼          ▼           ▼
Agents  Actions  Checks      Humans     Events
          │
          ▼
   Durable run events
          │
          ▼
   Artifacts + Evidence
```

Graph IR is therefore the stable waist of the Roflock architecture:

> Many ways to describe work above it.  
> Many ways to execute work below it.  
> One validated semantic contract in the middle.

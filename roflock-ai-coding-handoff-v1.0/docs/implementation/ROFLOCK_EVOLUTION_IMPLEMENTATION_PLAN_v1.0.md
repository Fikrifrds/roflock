# Roflock Evolution Implementation Plan v1.0

**Status:** Development execution plan  
**Target:** Existing `Fikrifrds/roflock` repository  
**Strategy:** Evolution, not rewrite  
**Companion:** Roflock Open Source PRD v1.0

---

# 1. Why this plan is different from a greenfield roadmap

The repository already contains a substantial working product. Current implementation includes packages for:

```text
agent-events
approval-engine
change-contracts
change-passport
command-runner
context-compiler
contracts
database
evidence
graph-core
graph-runtime
observability
policy-engine
provider-claude
provider-codex
provider-core
provider-cursor
provider-custom
repository-runtime
role-protocol
role-recommender
run-control
secret-store
test-support
usage-ledger
verification-runner
```

The current graph implementation already provides:

- typed graph nodes and edge conditions;
- Direct/Fast/Standard/Bug Fix/Critical templates;
- graph version compatibility;
- structural validation;
- bounded cycles/retry budgets;
- required deterministic checks;
- writer restrictions;
- explicit failure classification;
- dependency scheduling;
- concurrency control;
- reset of downstream state after retry;
- artifact authority gates.

The provider core already provides:

- explicit capabilities;
- model metadata;
- effort normalization;
- async invocation events;
- permission envelopes;
- process PID reporting;
- health/model discovery;
- failure classification such as quota/auth/model errors.

Therefore the correct migration is:

```text
current working system
      +
Roflock Language / Graph IR
      +
generalized public contracts
      +
durability/Studio/playground improvements
      =
Roflock
```

---

# 2. Architecture transition

## 2.1 Current conceptual architecture

```text
Web / CLI
   ↓
Task mode
   ↓
hard-coded WorkflowGraph
   ↓
graph-runtime.runGraph()
   ↓
role protocol + provider adapters
   ↓
repository / verification / approvals / evidence
```

## 2.2 Target architecture

```text
                  `.roflock`
                      │
                Language frontend
                      │
                    AST/CST
                      │
                   Compiler
                      │
                 Graph IR v1
                      │
        semantic/static validation
                      │
              Runtime Graph Adapter
                      │
            Evolved graph runtime
          ┌───────────┼───────────┐
          │           │           │
       Agents       Checks       Human
          │           │           │
       Drivers     runners     approvals
          └───────────┼───────────┘
                      │
             repository runtime
             policy / evidence
             durable events
```

No duplicate semantic engine.

---

# 3. Migration streams

Work is split into streams, but commits remain atomic.

## Stream A — OSS/rebrand safety

Purpose: make the repository truly Roflock without breaking persisted installations.

Deliver:

- product copy rename;
- license/governance docs;
- compatibility map for `ROLEFLOCK_*`;
- data path migration policy;
- CLI alias migration;
- package namespace migration plan;
- no destructive global replace.

Important: package namespace rebrand may happen after runtime integration if doing it first creates unnecessary churn.

## Stream B — Language and Graph IR integration

Purpose: integrate the already-designed Roflock language foundation into the monorepo.

Deliver packages:

```text
packages/graph-ir
packages/language
```

Optional split only when justified:

```text
packages/compiler
packages/graph-validator
```

The standalone foundation may initially keep compiler/validator within language/graph-ir packages to avoid fragmentation.

## Stream C — Compatibility bridge

Purpose: make new Graph IR executable by the existing runtime without replacing it.

Introduce a boundary like:

```ts
interface RuntimeGraph {
  ...
}

function graphIrToRuntimeGraph(ir: GraphIR): RuntimeGraph
```

or evolve `WorkflowGraph` itself if a compatibility RFC proves that is cleaner.

The first milestone is semantic equivalence, not perfect package naming.

## Stream D — Graph runtime extraction/hardening

Purpose: move from monolithic in-memory `runGraph()` to durable first-class execution contracts while preserving semantics.

Incrementally introduce:

```text
GraphRun
NodeRun
LoopAttempt
RuntimeEvent
EventStore
Projection
Scheduler
TransitionExecutor
```

Do not combine all extraction in one ticket.

## Stream E — Role and artifact generalization

Purpose: keep strong role authority while allowing arbitrary Roflock roles.

Move fixed built-in roles into a coding pack/profile.

Target conceptual model:

```ts
type RoleId = string;

interface RoleDefinition {
  id: RoleId;
  capabilities: CapabilityRequirement[];
  permissions: PermissionProfileRef;
  consumes?: ArtifactPort[];
  produces?: ArtifactPort[];
}
```

Existing `ROLE_AUTHORITY_MATRIX` remains a coding-specific compatibility profile until migrated.

## Stream F — Provider → driver evolution

Purpose: turn working provider adapters into first-class AgentDrivers.

Preserve:

- CLI process lifecycle;
- model/effort mapping;
- quota/auth/model failure detection;
- PID reporting;
- async invocation events.

Add:

- session identity;
- resume capability;
- explicit cancellation capability;
- driver capability disclosure;
- conformance suite.

## Stream G — Built-in workflow migration

Purpose: express Direct/Fast/Standard/Bug Fix/Critical using `.roflock`.

Keep their product behavior.

New source:

```text
workflows/
  direct.roflock
  fast.roflock
  standard.roflock
  bug-fix.roflock
  critical.roflock
```

The runtime should receive compiled IR, not special-case mode names.

Mode recommendation may still select a workflow template.

## Stream H — Playground/website foundation

Purpose: allow browser-only code → graph → diagnostics.

This can begin once Language + Graph IR packages are browser-safe.

Architecture:

```text
source editor
  ↓
browser language/compiler
  ↓
Graph IR
  ↓
graph renderer
  ↓
diagnostics
```

No local filesystem, shell, or coding-agent execution from the public website.

Later:

```text
Playground simulation
      ↓
Fake Driver
```

Real work remains in local/self-hosted runtime.

## Stream I — Studio evolution

Existing web UI evolves toward:

```text
Code | Diagram | Run | Evidence
```

Do not rebuild the current operational screens until new shared runtime/graph UI contracts are ready.

---

# 4. Phase sequence

## Phase R0 — Audit and freeze baseline

### Goals

Understand exactly what already works before changing architecture.

### Required work

- create a baseline tag or record commit SHA;
- capture root commands/results;
- inventory packages;
- inventory database schema/migrations;
- inventory persisted env/config names;
- inventory graph versions in data;
- map packages using KEEP/ADAPT/GENERALIZE/REPLACE;
- identify docs that remain authoritative vs historical.

### Exit

A single repo audit document can answer:

> What are we preserving, what are we changing, and why?

No runtime behavior change yet.

---

## Phase R1 — Roflock product compatibility/rebrand

### Goals

Make the repository externally Roflock while protecting old data.

### Deliver

- root name/description;
- README Roflock positioning;
- `roflock` CLI command;
- temporary `roleflock` CLI compatibility alias if practical;
- `ROFLOCK_*` env variables with legacy fallback;
- `~/.roflock` migration strategy;
- docs rename/redirect index;
- license/OSS docs.

### Do not yet

- rename every database column;
- rewrite event types;
- delete legacy config support;
- mix graph semantics changes into rebrand commits.

### Exit

Fresh installs are Roflock. Existing installs have a migration/fallback path.

---

## Phase R2 — Integrate Graph IR + Language

### Goals

Bring the Roflock language foundation into the existing pnpm monorepo.

### Deliver

```text
@roflock/graph-ir
@roflock/language
```

or temporary internal names if namespace migration is intentionally delayed.

Features:

- parser;
- AST;
- compiler;
- Graph IR schema/types;
- normalization/hash;
- semantic validation;
- language CLI commands.

### Compatibility requirement

Existing graph runtime is untouched except for dependency preparation.

### Exit

```bash
roflock check examples/bugfix.roflock
roflock compile examples/bugfix.roflock
```

work inside the real monorepo.

---

## Phase R3 — Graph IR runtime bridge

### Goals

Execute compiled Graph IR through existing runtime semantics.

### Work

- define adapter boundary;
- map IR node kinds to existing runtime node dispatch;
- map IR outcomes to current edge/failure classification;
- map loop groups to existing retry semantics where equivalent;
- map writers/permissions;
- map human nodes;
- map required check nodes;
- preserve graph version identity.

### Critical tests

1. trivial linear graph;
2. fail → retry → pass;
3. human gate;
4. required test cannot be bypassed;
5. invalid writer graph rejected;
6. loop exhaustion;
7. parallel readonly branch;
8. artifact gate.

### Exit

A compiled `.roflock` reference flow executes via the current runtime with fake deterministic executors.

This is the most important architectural milestone.

---

## Phase R4 — Convert built-in workflows to source

### Goals

Remove built-in graph shape as the only source of truth.

### Work

For each workflow:

```text
legacy TS graph
    ↓ snapshot
.roflock source
    ↓ compile
normalized IR
    ↓ compare
runtime execution regression
```

Do one workflow at a time:

1. Direct;
2. Fast;
3. Bug Fix;
4. Standard;
5. Critical.

Keep historical graph versions for existing runs.

### Exit

New tasks use compiled `.roflock` templates. Historical tasks still resolve their pinned legacy graph version.

---

## Phase R5 — Durable runtime model

### Goals

Turn current runtime transitions into durable first-class entities/events.

### Order

1. runtime event schema;
2. GraphRun/NodeRun state;
3. reducers;
4. event emission around current scheduler;
5. EventStore abstraction;
6. SQLite implementation;
7. snapshots;
8. boot reconciliation;
9. invocation idempotency;
10. outcome-unknown state.

### Key rule

First instrument existing behavior, then move behavior behind durable state.

Do not first rewrite scheduler as an event-sourced architecture in one shot.

### Exit

Forced daemon restart during a reference `.roflock` run preserves confirmed progress and does not blindly duplicate provider work.

---

## Phase R6 — Generic roles + typed artifacts

### Goals

Make language/runtime generic without losing coding governance.

### Work

- arbitrary RoleId;
- RoleDefinition;
- artifact type/ports;
- consumes/produces contracts;
- coding authority profile;
- static port/type validation;
- legacy role protocol adapter.

### Exit

A graph can use custom roles while existing planner/executor/verifier authority tests remain green.

---

## Phase R7 — AgentDriver v1

### Goals

Formalize existing provider runtime into driver API.

### Work

- DriverCapabilities;
- AgentRunRequest;
- AgentEvent;
- health/auth/detect;
- start;
- optional resume;
- interrupt/cancel truthfulness;
- usage;
- conformance suite.

### Migration order

1. fake driver;
2. Codex;
3. Claude;
4. OpenCode;
5. compatible HTTP/local;
6. Cursor/others where stable.

Do not remove working ProviderAdapter compatibility until equivalent driver integration passes.

---

## Phase R8 — Evidence/provenance unification

### Goals

Unify existing evidence, Change Contract, Execution Plan, verification, and Change Passport with general Roflock artifacts.

Preserve existing delivery-assurance depth.

Target:

```text
Outcome Contract
      ↓
Plan
      ↓
Patch
      ↓
TestReport
      ↓
ReviewFinding
      ↓
Approval
      ↓
Evidence Bundle / Passport
```

### Exit

`roflock evidence <run>` can explain a completed reference run from immutable artifacts/events.

---

## Phase R9 — Playground

### Goals

Public Mermaid-like Roflock authoring experience.

Deliver:

```text
Code editor
+
Diagram
+
Diagnostics
+
Examples
+
Share
+
Simulation
```

Browser-only compiler where possible.

Public Playground must not receive direct shell/filesystem access.

### Exit

A user can open `/play`, type a `.roflock` flow, see immediate graph/diagnostics, simulate it, and share a stable representation.

---

## Phase R10 — Studio

### Goals

Evolve current web application into flagship Studio without losing existing operational capability.

Signature layout:

```text
┌──────────────────────┬──────────────────────┐
│ Code                 │ Diagram              │
├──────────────────────┴──────────────────────┤
│ Run / Events / Terminal                    │
├─────────────────────────────────────────────┤
│ Evidence                                    │
└─────────────────────────────────────────────┘
```

Shared packages between website and Studio should include graph rendering and language editing where practical.

### Exit

Real coding workflow can be authored, run, monitored, approved, and audited from Studio.

---

# 5. Package target map

Recommended target, subject to audit:

```text
packages/
  contracts                  KEEP / evolve
  graph-ir                   ADD
  language                   ADD
  graph-core                 ADAPT
  graph-runtime              KEEP + HARDEN
  run-control                KEEP
  approval-engine            KEEP
  policy-engine              KEEP
  repository-runtime         KEEP
  command-runner             KEEP
  verification-runner        KEEP / integrate into checks
  context-compiler           KEEP
  evidence                   KEEP / generalize
  change-contracts           KEEP / coding pack + general goal model
  change-passport            KEEP / evidence bundle
  role-protocol              GENERALIZE with compatibility
  role-recommender           KEEP / coding pack
  provider-core              ADAPT → driver-core
  provider-codex             ADAPT → driver-codex
  provider-claude            ADAPT → driver-claude
  provider-cursor            ADAPT / later
  provider-custom            ADAPT → generic driver
  agent-events               KEEP / converge into Driver + Runtime event contracts
  database                   KEEP
  usage-ledger               KEEP
  observability              KEEP
  secret-store               KEEP
  test-support               EXPAND
```

Do not rename all packages as a prerequisite to runtime integration.

---

# 6. Graph semantics mapping

Current concepts → target concepts:

| Current | Target | Migration |
|---|---|---|
| `WorkflowGraph` | Graph IR / runtime graph | compatibility adapter |
| `GraphNode` | IR node | generalize |
| `WorkflowRole` fixed union | `RoleId` | generic role |
| `NodeKind.agent` | `agent` | keep |
| `model_call` | `model_call` | keep |
| `command` | `action` or compatibility kind | adapt |
| `test` | `check` | adapt |
| `router` | `route` | adapt |
| `join` | `join` | keep |
| `human_approval` | `human` | adapt |
| `context_compile` | `context` | adapt |
| `evidence_aggregate` | `evidence` | adapt |
| `EdgeCondition` failure enum | structured outcomes | compatibility mapping |
| `maxAttempts` | LoopPolicy/LoopGroup | generalize |
| `maxLoopIterations` | run safety ceiling | retain as secondary failsafe |
| `required` | acceptance/check policy | generalize |
| `writer` | effect/lease semantics | preserve strongly |
| built-in mode | workflow package/template | migrate |

Avoid forced public renames when a compatibility mapping is cheaper and safer.

---

# 7. Runtime semantic preservation tests

Before changing runtime core, freeze tests for:

- validation before run;
- dependency ordering;
- concurrency cap;
- no simultaneous writers;
- local maxAttempts;
- typed failure-edge routing;
- loop cap;
- descendant reset after failure route;
- siblings settle on failure;
- artifact gate on role start;
- artifact gate on role completion;
- required verification before accept;
- legacy graph version lookup.

These tests become anti-regression constraints throughout migration.

---

# 8. Architectural decisions requiring RFC

Do not decide casually:

- Graph IR v1 public schema changes;
- `.roflock` syntax/semantic changes;
- arbitrary role model;
- artifact port/type model;
- AgentDriver v1;
- runtime event public schema;
- package manifest/registry;
- organization policy language.

Internal refactors that preserve public semantics may use ADR instead.

---

# 9. Definition of successful migration

Roflock migration succeeds when all are true:

1. Existing safe coding workflow behavior is preserved.
2. New workflows can be authored as `.roflock`.
3. `.roflock` compiles to canonical Graph IR.
4. Graph IR executes through one runtime, not a parallel engine.
5. Existing providers become driver implementations.
6. Existing delivery assurance/evidence remains available.
7. Built-in workflows are templates, not privileged runtime code.
8. Historical graph versions remain reproducible.
9. CLI and Studio use the same compiler/runtime semantics.
10. Playground uses the same browser-compatible language/compiler semantics.
11. Open-source self-hosting is not artificially limited.
12. Full verification suite passes.

---

# 10. What not to optimize yet

Do not block core migration on:

- registry marketplace;
- non-coding industry packs;
- mobile app;
- complex long-term memory;
- graph database;
- Kubernetes;
- distributed scheduler;
- cloud billing;
- automatic production deployment;
- visual workflow editing round-trip before compiler/runtime vertical slice.

Priority remains:

```text
existing engine
→ Graph IR integration
→ executable `.roflock`
→ durability
→ driver contract
→ evidence
→ Playground/Studio
```

# Roflock Open Source — Product Requirements Document

**Version:** 1.0  
**Date:** 8 August 2026  
**Status:** Development Start Baseline  
**Product:** Roflock  
**Primary category:** Open-source executable workflow language and governed runtime for AI coding teams  
**Primary tagline:** AI coding teams as code.  
**Supporting line:** Describe. Run. Prove.  
**Working license:** Apache-2.0, subject to legal review before first public release.

---

## 0. Document authority

This PRD is the development-start product baseline for the open-source Roflock repository.

It supersedes product-level assumptions from the earlier RoleFlock direction where they conflict with the current Roflock language/compiler/runtime model or the true open-source product decision.

Order of authority for implementation:

1. This PRD.
2. Accepted Roflock RFCs for public language/runtime/API contracts.
3. Accepted ADRs for internal implementation choices.
4. Security policy and compatibility policy.
5. Atomic implementation ticket currently assigned.
6. Existing code where it does not conflict with items above.

A coding agent must not silently change a frozen product decision. If implementation reveals a blocker:

- document the blocker;
- create or propose an RFC/ADR as appropriate;
- keep the failing case as a fixture/test when possible;
- do not broaden scope merely because an alternative is easier to implement.

---

# 1. Executive summary

Roflock is an open-source platform for defining, compiling, running, verifying, observing, and replaying workflows made from AI coding agents, deterministic tools, and human approval steps.

Its primary interface is a small declarative language:

```roflock
flow BugFix {
  Reproduce
    -> Investigator
    -> Builder
    -> Tests

  Tests.fail
    -> Builder { max 3 }

  Tests.pass
    -> Reviewer

  Reviewer.changes
    -> Builder { max 2 }

  Reviewer.approve
    -> Approval

  Approval.approve
    -> Done
}
```

The source is parsed and compiled into a canonical Graph IR. The Graph IR is validated before the runtime is allowed to execute it.

```text
.roflock source
      ↓
Tokenizer / Parser
      ↓
AST
      ↓
Compiler
      ↓
Graph IR
      ↓
Semantic + policy validation
      ↓
Durable graph runtime
      ↓
Agent drivers / deterministic actions / human approvals
      ↓
Evidence, provenance, replay
```

Roflock is not primarily an agent framework that tries to provide every memory, tool, browser, research, or business-automation capability itself.

Instead, Roflock provides the structure around agents:

- explicit workflow control;
- bounded loops;
- coding-specific semantics;
- deterministic verification;
- provider/harness interoperability;
- externalized permission enforcement;
- human authority;
- durable execution;
- evidence and provenance.

Roflock initially targets software engineering because coding outputs can be checked with objective systems such as Git diffs, tests, type checks, builds, benchmarks, schemas, and repository assertions.

The core architecture remains domain-general. Future DevOps, security, data, research, and other domain packs may reuse the same graph/runtime abstractions without changing the initial coding-first market position.

---

# 2. Open-source product decision

Roflock is a **true open-source-first product**, not a deliberately crippled open-core edition.

The complete software necessary to use Roflock seriously on local or self-hosted infrastructure must be open source.

The governing rule is:

> Pay for operation and service, not for permission to use the fundamental product.

The following are intended to remain open source:

- `.roflock` language and specifications;
- tokenizer, parser, AST/CST and compiler;
- Graph IR and migrations;
- semantic/static validator;
- runtime and scheduler;
- durable event model and recovery;
- CLI;
- local/self-hosted Studio;
- agent-driver SDK;
- redistributable official drivers;
- custom provider and local-model support;
- repository/worktree runtime;
- policy and approval engine;
- evidence/provenance/replay;
- SDK/API;
- self-hosted control plane;
- self-hosted RBAC and audit;
- remote-runner protocol and self-hosting implementation;
- registry protocol, client, and self-hostable registry;
- extension/domain-pack SDKs.

Roflock must not introduce software-license caps on:

- number of agents;
- workflow nodes;
- local/self-hosted runs;
- repositories;
- self-hosted users;
- custom providers;
- local models;
- validator checks;
- policy checks;
- evidence completeness;
- replay;
- self-hosted RBAC;
- self-hosted audit.

A managed Roflock service may charge for real operated resources and responsibility, including:

- managed control-plane hosting;
- managed runner compute;
- storage;
- backups;
- high availability;
- upgrades/migrations;
- security operations;
- managed identity configuration;
- hosted private registry;
- support/SLA;
- onboarding/training;
- compliance assistance;
- professional services.

Cloud and self-hosted Roflock must share the same public workflow semantics.

---

# 3. Product definition

## 3.1 Product statement

> Roflock is a compiler-driven runtime for defining, running, and verifying AI coding teams.

Long form:

> Roflock lets developers describe AI coding agents, deterministic checks, tools, routing rules, retry boundaries, and human approvals as readable diagrams-as-code; compile them into a validated graph; run them through a durable local or self-hosted runtime; and preserve evidence of what happened.

## 3.2 Primary product category

**Open-source executable workflow language and governed runtime for AI coding teams.**

Secondary descriptions:

- coding-agent orchestration platform;
- coding harness control and governance layer;
- executable diagram language;
- AI teams as code.

## 3.3 Core functional model

### Language — Describe the work

The language describes:

- goals;
- roles;
- agents;
- actions;
- checks;
- routes;
- joins;
- human gates;
- edges;
- outcomes;
- bounded loops;
- artifacts;
- policies;
- effects;
- acceptance criteria.

### Runtime — Run the work

The runtime:

- resolves roles to drivers/models;
- schedules nodes;
- invokes coding harnesses and APIs;
- executes deterministic commands;
- controls routing and loops;
- persists events;
- recovers after interruption;
- enforces permissions and budgets;
- pauses for human authority;
- records usage and outputs.

### Evidence — Prove the result

The evidence system preserves:

- who/what executed each node;
- provider/model/driver identity;
- exact attempts and selected edges;
- tests/build/check results;
- diffs and patches;
- review findings;
- approvals;
- costs and timing;
- artifact hashes;
- acceptance-criterion evidence;
- provenance between artifacts and changes.

---

# 4. Problem statement

Modern coding agents are increasingly capable, but their work is commonly controlled through one-off prompts, provider-specific chat sessions, opaque internal loops, loosely enforced instructions, manual copy/paste between roles, and logs that do not establish why a change was accepted.

Teams need a way to describe **how work should flow**, not merely what a single model should do.

## 4.1 Control

A model should not own global workflow control, permission, budget, or approval authority.

## 4.2 Verification

Agent self-confidence is not evidence. Software work should use deterministic checks wherever possible before model judgement.

## 4.3 Interoperability

Developers already use multiple harnesses and models. Workflow definitions should survive provider changes.

## 4.4 Durability

Long-running work should survive process crashes, daemon restarts, context resets, user pauses, and provider failures.

## 4.5 Explainability and evidence

Users should be able to determine:

- why a file changed;
- which node changed it;
- what finding caused the change;
- which test verified it;
- which reviewer judged it;
- who approved it;
- what the run cost.

---

# 5. Product goals

## G1 — Make agent workflows readable

A common coding workflow should be understandable from a short `.roflock` file without framework boilerplate.

## G2 — Make workflow meaning compile-time inspectable

The compiler/validator must catch structural and safety failures before execution wherever possible.

## G3 — Execute real coding work

Roflock must invoke real coding harnesses and deterministic repository commands against real projects.

## G4 — Keep global control outside models

Permissions, approvals, writer leases, budgets, protected effects, cancellation, and workflow transitions must be runtime-enforced.

## G5 — Prefer objective verification

Tests, builds, linters, type checks, repository assertions, and schema checks should precede model-only judgement when relevant.

## G6 — Make long work durable

Confirmed progress must survive daemon restart and UI reconnect.

## G7 — Preserve complete evidence

A successful task must be explainable from its evidence bundle without relying on a model's narrative summary.

## G8 — Remain provider-agnostic

A workflow should be portable across Codex, Claude Code, OpenCode, compatible APIs, and future drivers when capabilities match.

## G9 — Remain local-first

A developer must be able to use Roflock against local source code without a mandatory Roflock-hosted service.

## G10 — Be fully useful when self-hosted

No essential correctness, security, collaboration, or extension capability may be intentionally disabled merely to create a paid tier.

---

# 6. Non-goals

The following are explicitly not goals for the initial stable product:

- replacing Codex, Claude Code, OpenCode, or every coding agent with a proprietary Roflock agent;
- becoming a generic no-code automation competitor;
- implementing hundreds of generic web/business tools before coding workflows are strong;
- building a proprietary agent-to-agent protocol when standards/adapters can be used;
- building a complex cognitive memory subsystem before workflow/runtime requirements justify it;
- supporting unbounded autonomous swarms;
- autonomous production deployment by default;
- allowing models to grant their own permissions;
- hiding critical security behavior in a closed Cloud service;
- making arbitrary general-purpose programming constructs part of `.roflock`;
- guaranteeing deterministic LLM output;
- automatic acceptance of code merely because an agent says it is correct.

---

# 7. Target users

## 7.1 AI-heavy individual developer

Uses one or more coding harnesses/models and needs repeatable workflows for bug fixing, feature building, refactoring, test improvement, review, and security analysis.

## 7.2 Small engineering team

Needs shared workflow definitions, repeatable review policy, evidence, approval, provider flexibility, and local/self-hosted operation.

## 7.3 AI tooling / platform engineer

Needs SDK, driver contract, headless runtime, CI integration, workflow packages, event APIs, and custom policies.

## 7.4 Enterprise engineering organization

Eventually needs self-hosted control plane, RBAC, SSO integrations, organization policies, remote runners, central audit/evidence, private registry, and fleet/provider administration.

## 7.5 Extension/domain-pack author

Needs stable APIs for drivers, checks, policies, workflows, domain packs, and registry publishing.

---

# 8. Core jobs to be done

1. Define a reproduction → test → fix → verification → independent review workflow that cannot loop forever.
2. Ensure feature development follows reusable planning, implementation, checks, review, verification, and acceptance contracts.
3. Assign different coding agents to roles without rewriting workflow semantics around provider APIs.
4. Surface risky actions as typed confirmation requests.
5. Resume after crash from a confirmed boundary without silently duplicating paid work.
6. Review evidence instead of trusting a model summary.
7. Fork/replay the same workflow from a checkpoint with another driver/model.
8. Run the complete product without mandatory Roflock Cloud.

---

# 9. Product surfaces

Roflock is one product with multiple interfaces over one semantic engine.

```text
                   Roflock
                      │
             Roflock Language
                      │
                  Compiler
                      │
                  Graph IR
                      │
                Runtime Core
                      │
        ┌─────────────┼──────────────┐
        │             │              │
       CLI          Studio          SDK
        │             │              │
        └─────────────┼──────────────┘
                      │
                Control Plane
            local/self-host/managed
```

## 9.1 CLI

First-class headless interface:

```bash
roflock check workflow.roflock
roflock compile workflow.roflock
roflock run workflow.roflock
roflock status run_123
roflock evidence run_123
roflock approve run_123 approval_node
roflock pause run_123
roflock resume run_123
roflock cancel run_123
roflock replay run_123
roflock fork run_123 --from Reviewer
```

## 9.2 Daemon

Local runtime host and API, bound to localhost by default. Browser/Studio must not directly spawn agent CLIs or arbitrary shell commands.

## 9.3 Studio

Flagship visual product with synchronized views:

```text
Code | Diagram | Run | Evidence
```

Studio is open source and useful locally/self-hosted without Cloud.

## 9.4 SDK

Embeddable APIs for compiling/running workflows.

## 9.5 Self-hosted control plane

Team orchestration, policy, audit, approvals, runner management, shared workflows, and RBAC.

## 9.6 Registry

Public/private packages for workflows, roles, checks, policies, drivers, and domain packs.

---

# 10. Current implementation baseline

The project does not begin from zero.

Current Roflock foundation already establishes:

### Graph IR

- Graph IR v1 TypeScript reference types;
- canonical normalization;
- stable JSON serialization;
- semantic SHA-256 hashing;
- semantic validator;
- RF diagnostic codes.

### Language

- tokenizer with source spans/comments;
- recursive-descent parser;
- AST;
- `.roflock` → Graph IR compiler;
- explicit agent outcome declarations;
- bounded-edge → LoopGroup lowering;
- generated default safety policies;
- RL and RF diagnostics.

### CLI foundation

- `check`;
- `compile`;
- `validate-ir`;
- `normalize-ir`;
- `hash-ir`;
- `stamp-ir`.

### Verified baseline

Current prototype passed:

- 12/12 Graph IR tests;
- 6/6 language tests;
- TypeScript strict build.

This PRD treats Language Foundation as **M0 substantially complete**, while allowing hardening changes discovered by runtime integration.

Known limitations:

- artifact syntax not yet exposed in Language v0.1;
- joins/parallel list syntax not yet exposed;
- imports/subflows/profiles/domain packs not yet exposed;
- full branch-region concurrent-writer analysis not yet implemented;
- runtime typed confirmations not yet implemented;
- no real coding-agent invocation in the standalone language foundation.

---

# 11. Frozen product decisions

These are implementation constraints unless changed by accepted RFC.

1. `.roflock` text is a canonical human-readable workflow source format.
2. Graph IR is the canonical semantic contract between language frontends and runtime.
3. AST, Graph IR, and runtime state are separate concepts.
4. The language remains declarative, not a general-purpose programming language.
5. Common workflows must remain visually readable.
6. Every graph cycle is bounded.
7. Retry must be driven by concrete feedback/evidence where policy requires it.
8. One active writer owns a task worktree unless a future explicitly safe parallel-write design is accepted.
9. Deterministic verification precedes model judgement where possible.
10. Models cannot grant themselves permission.
11. Human authority is represented by typed durable runtime state.
12. Protected side effects are classified outside model prompt text.
13. Stop/cancel/pause are runtime primitives.
14. Runtime state is durable and recoverable.
15. Provider count is not a quality metric.
16. Use the smallest sufficient workflow.
17. Source code remains local unless the user explicitly chooses a provider/runner that receives selected context.
18. The core product is open source and self-hostable.
19. Cloud must not use a private incompatible workflow semantics engine.
20. Major public contract changes require RFCs.

---

# 12. High-level architecture

```text
┌────────────────────────────────────────────────────────────────┐
│                           Surfaces                              │
│ CLI · Studio · SDK · Self-hosted Control Plane                │
└──────────────────────────────┬─────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────┐
│                     Language Toolchain                         │
│ tokenizer · parser · AST/CST · compiler · formatter · LSP     │
└──────────────────────────────┬─────────────────────────────────┘
                               │
                         Roflock Graph IR
                               │
┌──────────────────────────────▼─────────────────────────────────┐
│                        Runtime Core                            │
│ scheduler · transitions · loops · joins · node lifecycle      │
│ event reducers · run control · leases · approvals             │
└────────────┬─────────────────┬────────────────┬────────────────┘
             │                 │                │
┌────────────▼──────┐ ┌────────▼──────┐ ┌──────▼───────────────┐
│ Agent Drivers     │ │ Deterministic │ │ Repository Runtime   │
│ Codex / Claude /  │ │ Runtime       │ │ Git/worktrees/diff   │
│ OpenCode / APIs   │ │ commands/check│ │ writer isolation     │
└────────────┬──────┘ └────────┬──────┘ └──────┬───────────────┘
             │                 │                │
             └─────────────────┼────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────┐
│ Policies · Evidence · Usage · Context · Observability         │
└──────────────────────────────┬─────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────┐
│ Storage adapters: SQLite · Postgres · object/file stores      │
└────────────────────────────────────────────────────────────────┘
```

One semantic engine must serve CLI, Studio, SDK, and self-hosted/cloud control planes.

---

# 13. Recommended repository structure

```text
roflock/
├── apps/
│   ├── cli/
│   ├── daemon/
│   ├── studio/
│   └── control-plane/
├── packages/
│   ├── contracts/
│   ├── language/
│   ├── language-server/
│   ├── graph-ir/
│   ├── compiler/
│   ├── graph-validator/
│   ├── runtime-core/
│   ├── event-store/
│   ├── run-control/
│   ├── approval-engine/
│   ├── policy-engine/
│   ├── repository-runtime/
│   ├── command-runner/
│   ├── context-compiler/
│   ├── evidence/
│   ├── usage-ledger/
│   ├── quota/
│   ├── driver-core/
│   ├── driver-codex/
│   ├── driver-claude/
│   ├── driver-opencode/
│   ├── driver-openai-compatible/
│   ├── driver-anthropic-compatible/
│   ├── driver-custom-http/
│   ├── mcp-adapter/
│   ├── a2a-adapter/
│   ├── registry-client/
│   ├── registry-server/
│   ├── sdk/
│   ├── observability/
│   ├── database/
│   ├── secret-store/
│   └── test-support/
├── docs/
│   ├── prd/
│   ├── rfc/
│   ├── adr/
│   ├── security/
│   ├── operations/
│   └── test-plans/
├── examples/
├── fixtures/
├── scripts/
├── AGENTS.md
├── LICENSE
├── NOTICE
├── SECURITY.md
├── CONTRIBUTING.md
├── pnpm-workspace.yaml
└── package.json
```

Packages may be consolidated when separation adds ceremony without meaningful boundaries, but public contracts must remain explicit.

---

# 14. Recommended technology baseline

Unless implementation evidence shows a blocker:

## Runtime / packages

- TypeScript;
- Node.js 24+;
- pnpm workspaces;
- strict TypeScript;
- Zod or equivalent for internal runtime validation;
- JSON Schema for public/external structural contracts.

## Daemon

- Fastify or another small typed HTTP framework;
- localhost auth token;
- SSE initially for live event projection;
- WebSocket only when bidirectional real-time requirements justify it.

## Persistence

Local:

- SQLite;
- WAL mode;
- append-only event table;
- materialized projections/snapshots;
- explicit migrations.

Self-hosted team:

- Postgres adapter;
- object/file storage interface for large evidence artifacts.

## Studio

- Vite + React + TypeScript;
- TanStack Query;
- accessible component primitives;
- CodeMirror or Monaco for `.roflock` editing;
- graph canvas introduced only after runtime semantics are reliable.

## Testing

- Vitest;
- Playwright;
- temporary Git repositories;
- fake CLI executables;
- fake HTTP providers;
- crash/fault injection.

Avoid unnecessary infrastructure complexity before scale requires it.

---

# 15. Roflock Language requirements

## 15.1 Design goals

The language must be readable, compact, Git-friendly, deterministic to parse, explicit about outcomes, statically analyzable, easy for humans and AI systems to author, and stable enough to become an ecosystem format.

## 15.2 Declarative language

Do not add arbitrary `while`, unrestricted `for`, classes, general functions, or unrestricted mutable global variables. Repetition is represented by bounded graph cycles.

## 15.3 Initial public primitives

Target primitives:

- `goal`;
- `role`;
- `agent`;
- `action`;
- `check`;
- `route`;
- `join`;
- `human`;
- `event`;
- `artifact`;
- `terminal`;
- `flow`;
- `entry`;
- edges;
- outcomes;
- bounded retry metadata.

## 15.4 Structured outcomes

Bad:

```roflock
Review -> Fix if "review looks bad"
```

Preferred:

```roflock
Review.approve -> Approval
Review.changes -> Builder
Review.blocked -> Human
```

## 15.5 Diagnostics

Diagnostics must include stable code, severity, source span, concise explanation, and a suggested fix when reliably possible.

Examples:

```text
RF210 Unbounded cycle
RF301 Concurrent writers
RF501 Protected effect without approval
RL102 Unknown node
RL122 Unknown outcome
```

## 15.6 Source/visual round trip

Long-term Studio visual editing must preserve `.roflock` source as canonical. Plan for CST/comment-preserving editing before visual edits become destructive.

---

# 16. Graph IR requirements

Graph IR is the semantic boundary between authoring and execution.

## 16.1 Properties

Graph IR must be explicit, versioned, deterministic to normalize, serializable, hashable, inspectable, migratable, and free of ephemeral runtime state.

## 16.2 IR describes

At minimum:

- workflow identity/version;
- nodes and types;
- role/capability requirements;
- typed outcomes;
- edges and edge conditions;
- loop groups;
- artifacts/ports where supported;
- goals/acceptance requirements;
- permission/effect metadata;
- policy references;
- source mapping/debug metadata;
- semantic version/hash.

## 16.3 IR excludes

- current node execution state;
- process IDs;
- current approval decisions;
- ephemeral stdout streams;
- live provider session state;
- current attempt counters.

Those belong to runtime state/events.

## 16.4 Hashing

Semantic hash ignores non-semantic source/editor metadata but changes when executable meaning changes.

---

# 17. Static and semantic validation

Validation is a first-class open-source product capability.

Required analyses:

### Structural

- duplicate IDs;
- unresolved nodes/roles;
- invalid outcomes;
- invalid terminal/entry nodes.

### Reachability

- unreachable nodes;
- no reachable terminal;
- unintended dead ends.

### Cycles

- strongly connected component detection;
- reject unbounded cycles;
- valid verifier/exhaustion semantics;
- attempt/time/cost constraints as configured.

### Writer safety

- direct parallel writer conflict;
- later branch-region concurrency analysis;
- worktree writer lease compatibility.

### Artifact/type safety

- missing producer;
- missing required input;
- incompatible artifact type/schema;
- invalid join requirements.

### Approval/effect safety

- protected-effect classification;
- required human/approval dominance;
- impossible policy combinations.

### Outcome contract

- each required criterion has a verifier;
- prohibited outcomes cannot be satisfied by missing evidence;
- critical workflow has acceptance authority.

---

# 18. Runtime Core requirements

## 18.1 Responsibility

Given validated Graph IR and runtime inputs, execute graph transitions correctly and durably.

## 18.2 Runtime entities

At minimum:

- `Task`;
- `GraphRun`;
- `NodeRun`;
- `LoopAttempt`;
- `Invocation`;
- `Event`;
- `RuntimeLease`;
- `WriterLease`;
- `ProcessHandle`;
- `Artifact`;
- `EvidenceRef`;
- `ConfirmationRequest`;
- `ApprovalDecision`;
- `UsageEntry`.

## 18.3 Task states

```text
DRAFT
READY
QUEUED
RUNNING
AWAITING_APPROVAL
CHANGES_REQUIRED
BLOCKED
PAUSED
CANCELLING
CANCELLED
FAILED
COMPLETED
ARCHIVED
```

## 18.4 Node states

```text
PENDING
WAITING_FOR_DEPENDENCY
READY
RUNNING
AWAITING_APPROVAL
INTERRUPTED
INTERRUPTED_UNCLEAN
RETRYING
PASSED
CHANGES_REQUIRED
SKIPPED
BLOCKED
CANCELLED
FAILED
```

## 18.5 Scheduler

Scheduler must identify runnable nodes, respect dependencies/loops/concurrency, acquire leases, avoid duplicate transitions, stop new work during pause/cancel, and support safe read-only parallelism.

## 18.6 Edge selection

Edge selection is deterministic given node outcome, priority, policy state, human decision, and runtime failure class. A model may only influence routing through a graph-declared structured outcome.

---

# 19. Runtime events and durability

## 19.1 Event sourcing principle

Every meaningful transition creates an immutable event.

Examples:

```text
run.created
run.started
node.ready
node.started
invocation.started
message.delta
tool.requested
tool.completed
artifact.created
node.completed
node.failed
edge.selected
loop.retry
approval.requested
approval.resolved
control.pause.requested
control.pause.completed
run.completed
run.failed
```

## 19.2 Event contract

```typescript
interface RoflockEvent {
  eventId: string;
  schemaVersion: string;
  runId: string;
  taskId?: string;
  nodeId?: string;
  nodeRunId?: string;
  attempt?: number;
  sequence: number;
  timestamp: string;
  type: string;
  payload: unknown;
}
```

## 19.3 Idempotency

Conceptual stable keys:

```text
graph run    = task_id + graph_version
node attempt = graph_run_id + node_id + attempt
invocation   = node_run_id + invocation_index
approval     = request_id + decision_version
control      = node_run_id/run_id + command_type + command_version
```

## 19.4 Recovery

After daemon restart:

1. read snapshot/projection;
2. replay later events;
3. reconcile processes;
4. reconcile runtime/writer leases;
5. inspect worktree state;
6. mark ambiguous external outcomes explicitly;
7. resume only from confirmed boundaries;
8. never blindly duplicate a potentially billable invocation.

Use explicit `OUTCOME_UNKNOWN` when external completion cannot be established.

---

# 20. Run control

Required commands:

- pause task;
- resume task;
- cooperative stop node;
- force terminate node;
- cancel task;
- emergency stop workspace/control plane.

Graceful pause may wait for provider response completion, allowlisted command completion, atomic file write, test process completion, or durable artifact persistence.

Force termination must record what was killed, inspect repository changes, mark unclean interruption, and prevent automatic writer retry until reconciliation.

---

# 21. Repository runtime

Roflock coding workflows require first-class repository semantics.

## 21.1 Registration

Store canonical path, repository type, default branch, detected build/test metadata, repository fingerprint, and allowed execution root.

## 21.2 Worktree isolation

By default each modifying task gets an isolated Git worktree.

## 21.3 One-writer rule

Only one active writer may own a task worktree. Safe read-only nodes may run concurrently.

## 21.4 Change capture

Capture base/current commit, working tree status, changed files, patch/diff, optional staged diff, and artifact hashes.

## 21.5 User source protection

Never silently reset/discard user changes. On interruption offer inspect, retain worktree, create patch, resume, or explicitly revert Roflock-owned changes when safe and authorized.

---

# 22. Deterministic command and check runtime

`action` and `check` nodes are non-agent execution paths.

```typescript
interface CommandResult {
  commandId: string;
  executable: string;
  args: string[];
  cwd: string;
  startedAt: string;
  completedAt: string;
  exitCode: number | null;
  signal?: string;
  stdoutRef?: string;
  stderrRef?: string;
  timedOut: boolean;
}
```

Initial native categories:

- test;
- lint;
- typecheck;
- build;
- formatting check;
- repository assertion;
- schema/database assertion where configured.

Outcome mapping:

```text
exit code 0     → pass
non-zero        → fail
timeout         → timeout
policy denial   → blocked
interruption    → interrupted
```

---

# 23. Agent Driver system

## 23.1 Purpose

Orchestrate existing agent runtimes without binding workflow semantics to a provider.

## 23.2 Conceptual driver contract

```typescript
interface AgentDriver {
  id: string;
  detect(): Promise<DriverAvailability>;
  authenticate(): Promise<AuthStatus>;
  capabilities(): Promise<DriverCapabilities>;
  start(request: AgentRunRequest): AsyncIterable<AgentEvent>;
  resume?(sessionId: string, input: AgentInput): AsyncIterable<AgentEvent>;
  interrupt?(runId: string): Promise<InterruptResult>;
  dispose?(sessionId: string): Promise<void>;
}
```

Final v1 contract requires RFC.

## 23.3 Capability disclosure

Drivers state support truthfully for readonly/workspace-write, tool calling, structured output, resumable sessions, cancellation, process signals, model/effort selection, usage events, context limits, image input, and enforceable network/tool restrictions.

## 23.4 Initial driver priority

1. deterministic fake driver;
2. Codex App Server/CLI;
3. Claude Code;
4. OpenCode;
5. OpenAI-compatible;
6. Anthropic-compatible;
7. custom HTTP/local endpoints.

Cursor/Grok/additional harnesses follow when stable non-interactive integration exists.

---

# 24. Roles and profiles

A role describes responsibility/capability, not necessarily a model.

```roflock
role Architect {
  requires reasoning.high
  readonly
}

role Builder {
  requires coding.write
}

role Reviewer {
  requires coding.review
  readonly
}
```

Execution profiles resolve roles to drivers/models. Runtime architecture must not assume role == provider.

---

# 25. Context Compiler

Conceptual context formula:

```text
Stable Role Contract
+ Task Objective
+ Current Graph State
+ Acceptance Criteria
+ Relevant Repository Context
+ Input Artifacts
+ Previous Attempt Evidence
+ Review Findings
+ Policy Disclosure
+ Driver/Model Profile
= Invocation Context
```

Requirements:

- inspectable selection;
- secret filtering;
- explicit context budget;
- fresh-session handoff reconstruction;
- previous failure evidence without unrelated history;
- driver formatting separated from semantic context.

Future memory/retrieval systems plug into this layer instead of changing graph semantics.

---

# 26. Permissions and policy engine

Prompt text is not a security boundary.

Conceptual profile:

```roflock
permissions {
  read "**"
  write ["src/**", "tests/**"]
  shell ["npm test", "npm run lint"]
  deny secrets
  deny deploy
  deny network
}
```

Initial protected effects include:

- workspace write;
- dependency change;
- network access;
- secret access/exposure;
- database write;
- destructive filesystem operation;
- Git push;
- merge;
- deploy;
- production access;
- auth/authorization policy change;
- payment mutation;
- public publishing;
- external irreversible side effect.

Authority order:

```text
organization policy
      ↓
workspace/project policy
      ↓
workflow policy
      ↓
role/node permission request
```

A lower level cannot override a higher-level deny.

---

# 27. Typed confirmation and approval protocol

Natural-language questions in model output do not themselves grant permission or block execution. Permission requests use a typed protocol.

```typescript
interface ConfirmationRequest {
  id: string;
  runId: string;
  nodeRunId: string;
  attempt: number;
  requestType:
    | 'clarify_requirement'
    | 'expand_scope'
    | 'write_path'
    | 'run_command'
    | 'network_access'
    | 'dependency_change'
    | 'database_change'
    | 'external_side_effect'
    | 'provider_switch'
    | 'additional_budget'
    | 'policy_exception';
  title: string;
  rationale: string;
  exactAction: unknown;
  affectedPaths?: string[];
  estimatedAdditionalCost?: number;
  riskClass: 'low' | 'medium' | 'high' | 'critical';
  proposedResumeEdge?: string;
  expiresAt?: string;
  fingerprint: string;
}
```

Approvals are durable, auditable, typed, scope-bound, revocable where reusable, and invalidated when security-relevant state changes.

Fresh explicit approval is required initially for secret exposure, push/merge, deployment/production, destructive actions, auth/authorization changes, payment mutations, write-effect migrations, and similar critical irreversible effects.

---

# 28. Goals, outcome contracts, and acceptance criteria

Workflow success is not equivalent to "the final node executed."

```roflock
goal "Prevent duplicate webhook processing" {
  require "duplicate event creates at most one payment"
    verify Tests.concurrent_duplicate

  require "existing payment tests remain green"
    verify Tests.payment

  forbid "breaking webhook signature validation"

  risk high
}
```

Required concepts:

- objective;
- acceptance criteria;
- prohibited outcomes;
- required evidence;
- risk classification;
- out-of-scope list.

Criteria may be verified by deterministic test, command, repository assertion, schema/database assertion, browser assertion, model review, or human decision. Deterministic criteria take precedence where applicable.

---

# 29. Evidence and provenance

Evidence is a core result model.

Every significant artifact supports:

- artifact ID;
- type;
- schema/version;
- producing node/attempt;
- producing driver/provider/model;
- input references;
- timestamp;
- content/storage reference;
- digest/hash;
- confidentiality classification where relevant.

Coding evidence examples:

- reproduction log;
- failing regression test;
- patch/diff;
- test/build/lint/typecheck report;
- review findings;
- human approval;
- context disclosure manifest;
- usage/cost record.

At completion produce a portable non-secret evidence manifest with hashes.

Long-term `roflock why` reconstructs provenance without asking a model to invent an explanation.

---

# 30. Cost, usage, and quota

Distinguish:

- actual cost;
- shadow/estimated cost;
- unknown cost;
- token/usage metrics;
- provider quota estimates/snapshots.

Do not present local counters as authoritative account-wide quota unless the provider exposes authoritative data.

Budget policy may define warning, pause, hard stop before next billable invocation, and confirmation for additional budget.

---

# 31. Replay, fork, simulation, evaluation

## Replay

Reconstruct historical execution from events/artifacts without mutating history.

## Fork

Fork a run from a confirmed checkpoint with another model/provider/workflow/context while preserving the original.

## Simulation

Execute graph semantics using fake nodes/scenarios to test routing, loop exhaustion, provider failure, approvals, budgets, and quota behavior without paid/model side effects.

## Evaluation

Later compare success, checks passed, cost, time, retries, findings, regressions, and model-role combinations. Evaluation software remains open source; managed large-scale execution may be a paid service.

---

# 32. CLI requirements

Initial commands:

```text
roflock check
roflock compile
roflock format
roflock validate-ir
roflock normalize-ir
roflock run
roflock status
roflock events
roflock logs
roflock pause
roflock resume
roflock stop
roflock cancel
roflock approve
roflock reject
roflock evidence
```

Later:

```text
roflock replay
roflock fork
roflock simulate
roflock why
roflock add
roflock publish
roflock doctor
```

Human-readable by default; `--json` where useful for CI/automation.

Stable exit-code policy distinguishes success, compile/validation failure, runtime failure, blocked/approval state, configuration error, and internal error.

---

# 33. Studio requirements

Studio is a full open-source product surface, not a teaser.

## Code

`.roflock` editor, highlighting, diagnostics, formatting, later autocomplete/LSP and quick fixes.

## Diagram

Deterministic graph rendering, edge outcome labels, loop visibility, parallel branches, human/approval nodes, live node state, no source-of-truth divergence.

## Run

Show task/run, active node, role, driver/provider/model, effort/profile, permission profile, phase, heartbeat, elapsed time, attempts, command/tool, cost/usage, and run controls. A generic spinner cannot be the only representation of background execution.

## Evidence

Show goals/criteria, supporting evidence, diffs, tests, findings, approval, provenance, and export.

## Approval Inbox

Show exact action, origin run/node, role/driver/model, affected paths, command/diff preview, risk, budget impact, and next state on approve/reject.

---

# 34. Local daemon/API

Representative API, not frozen route names:

```text
GET  /api/health
GET  /api/projects
POST /api/projects
POST /api/projects/:id/validate
GET  /api/workflows
POST /api/workflows/compile
POST /api/workflows/validate
GET  /api/tasks
POST /api/tasks
GET  /api/tasks/:id
POST /api/tasks/:id/start
POST /api/tasks/:id/pause
POST /api/tasks/:id/resume
POST /api/tasks/:id/cancel
GET  /api/runs/:id
GET  /api/runs/:id/events
GET  /api/runs/:id/evidence
GET  /api/runs/:id/diff
GET  /api/runs/:id/cost
POST /api/approvals/:id/approve
POST /api/approvals/:id/reject
GET  /api/drivers
POST /api/drivers/:id/health
```

Live events initially via SSE. API schemas should derive from shared contracts where practical.

---

# 35. SDK requirements

Third-party applications must be able to:

```text
parse(source)
compile(source)
validate(graph)
createRuntime(config)
startRun(graph, input)
streamEvents(runId)
pause(runId)
resume(runId)
cancel(runId)
resolveApproval(requestId, decision)
readEvidence(runId)
```

SDK must not require Roflock Cloud.

---

# 36. Self-hosted team/control plane

Open-source roadmap includes:

- workspaces/organizations;
- projects/repositories;
- users/service identities;
- roles/RBAC;
- shared workflows;
- shared run history;
- shared approvals;
- central policy;
- driver/provider administration;
- runner registration;
- audit log;
- evidence retention configuration;
- private registry integration.

Managed Roflock may operate these as a service but must not intentionally make self-hosted semantics incomplete.

---

# 37. Registry and workflow packages

Package types:

- workflows;
- roles;
- checks;
- policies;
- drivers;
- domain packs;
- context/skill extensions.

Manifest must declare identity/version, publisher, license, compatible Roflock version, requested permissions/effects, network requirements, secrets, commands/tools, included workflows, and integrity information.

Packages are untrusted by default. Private registry server is self-hostable and open source.

---

# 38. Extensibility

Stable extension points should include:

- AgentDriver;
- Tool/ActionProvider;
- CheckProvider;
- PolicyProvider;
- EvidenceProvider;
- ContextProvider;
- EventStore;
- ArtifactStore;
- SecretStore;
- Runner transport;
- registry/package hooks.

Public extension contracts require versioning and compatibility tests.

---

# 39. Observability

Always expose structured logs, runtime events, active execution, driver health, process status, usage, cost, and scheduler state.

Consider OpenTelemetry for traces/metrics/logs. Export is opt-in for local/self-host users.

Observability must distinguish known, estimated, unsupported, and unknown values. Never simulate precision for quota/cancellation/cost data.

---

# 40. Data model

Logical persistent entities:

```text
Workspace
User
Project
Repository
Task
WorkflowSource
GraphVersion
GraphRun
NodeRun
LoopAttempt
Role
ExecutionProfile
Driver
DriverConnection
ModelConfig
PermissionProfile
Sandbox
Worktree
Session
Event
Invocation
UsageLedgerEntry
QuotaSnapshot
BudgetPolicy
ConfirmationRequest
ApprovalDecision
ApprovalGrant
ControlCommand
RuntimeLease
WriterLease
ProcessHandle
ExecutionSnapshot
Artifact
EvidenceRef
TestRun
ReviewFinding
AuditEvent
RegistryPackage
Runner
```

Not all logical entities require separate tables in the first runtime.

---

# 41. Privacy

## Local-first

Local product stores operational data locally.

## Provider disclosure

Before sending context externally Roflock should know provider/model, task/node, context categories, included source, and secret filtering status.

## Secrets

Raw secrets stay out of normal logs/events, use configured secret backend, are passed only to authorized actions, and are redacted from exports.

## Telemetry

No product telemetry without consent.

---

# 42. Security threat model

Assume model output may be malicious/wrong, repository content may contain prompt injection, workflow packages may be malicious, commands may be destructive, provider completion may be ambiguous, approvals may become stale, and child processes may outlive parents.

Primary controls:

- external permission enforcement;
- protected-effect taxonomy;
- command allow/deny;
- typed confirmations;
- worktree isolation;
- one-writer lease;
- secret redaction;
- event audit;
- approval invalidation;
- process reconciliation;
- no blind retry of ambiguous billable execution;
- package permission inspection.

Security-sensitive changes require adversarial/negative tests.

---

# 43. Reliability requirements

Stable product must demonstrate:

- durable task state through restart;
- idempotent graph transitions;
- no accidental duplicate billable invocation after recovery;
- writer lock reconciliation;
- recoverable event store;
- clean cancellation semantics;
- truthful interrupted/unclean state;
- deterministic loop exhaustion;
- consistent evidence export.

Do not claim safe remote cancellation when only a local wrapper was killed.

---

# 44. Performance targets

Initial local targets on a normal modern developer machine:

- CLI `check` small workflow: <250 ms warm target;
- typical workflow compile: <500 ms;
- local health API: <100 ms;
- event-to-UI update: <1 s;
- task creation excluding repository validation: <1 s;
- at least 20 queued tasks;
- at least 4 simultaneous read-only nodes where policy/resources permit.

Correctness/durability take precedence over optimization.

---

# 45. Accessibility

Studio target:

- WCAG 2.1 AA;
- keyboard navigation;
- visible focus;
- non-color-only status;
- accessible graph/list alternative;
- accessible diff/log controls;
- reduced-motion support.

Diagram cannot be the only way to understand state.

---

# 46. Installation and packaging

Target user experience:

```bash
npm install -g roflock
roflock doctor
roflock check example.roflock
```

Development:

```bash
git clone <repo>
pnpm install
pnpm build
pnpm test
```

Later distribution may include npm CLI, standalone binaries, Homebrew, Windows package, Studio installer, and Docker images for server components.

A clean clone must build/test without proprietary Roflock infrastructure.

---

# 47. Documentation requirements

Before public alpha:

- README;
- quick start;
- language guide;
- Graph IR reference;
- driver authoring guide;
- workflow examples;
- security model;
- permission model;
- evidence model;
- self-host guide for available surfaces;
- contribution guide;
- compatibility/version policy;
- architecture overview.

Examples should execute in CI where feasible.

---

# 48. Versioning and compatibility

Version separately:

- Roflock Language major;
- Graph IR major;
- runtime event schema;
- Driver API;
- Plugin SDK;
- workflow package manifest.

Rules:

- stable source does not silently change meaning inside a language major;
- migrations are explicit;
- Graph IR changes include compatibility fixtures;
- driver/plugin public breaks require major versioning;
- migration output is inspectable.

---

# 49. Open-source governance requirements

Initial governance is maintainer-led.

- normal implementation via PR;
- semantic public contract changes via RFC;
- important internal architecture decisions via ADR;
- security reports via private security process.

Contribution changes require tests. Security-sensitive semantics require negative/adversarial tests. Language/IR changes require valid/invalid fixtures.

Working license: Apache-2.0. Trademark policy is separate. Legal review required before first public stable release.

---

# 50. Development phases

## M0 — Language Foundation

**Status:** substantially complete.

Deliverables: Graph IR v1, tokenizer/parser/AST, compiler, semantic validator, CLI compile/check, baseline diagnostics.

Exit: foundation tests green, clean monorepo integration, RFC-001/002 accepted as baseline.

## M1 — Reference Runtime

Goal:

```bash
roflock run examples/bugfix.roflock
```

runs a full graph with deterministic/fake nodes.

Deliver:

- GraphRun;
- NodeRun;
- scheduler;
- edge selection;
- loop controller;
- in-memory event store first;
- fake agent driver;
- action/check runner abstraction;
- runtime CLI commands.

Exit scenario:

```text
Builder
  → Tests fail
  → Builder retry
  → Tests pass
  → Reviewer approve
  → Human approval
  → Done
```

## M2 — Durable Runtime, Approval, Evidence

Deliver SQLite event store, reducer projections, snapshots, restart recovery, runtime/writer leases, pause/resume/stop/cancel, typed confirmation, human approval, evidence/artifacts, repository/worktree runtime, deterministic command execution.

Exit: reference BugFix survives forced daemon restart without losing confirmed state or duplicating work.

## M3 — Agent Driver Contract

Deliver stable Driver API RFC, capability discovery, AgentEvent model, cancellation capability model, fake driver conformance suite, driver SDK docs.

Exit: third-party fake/test driver can be implemented using public contracts only.

## M4 — Codex Vertical Slice

Deliver Codex driver, readonly/writer modes, event/result mapping, cancellation/recovery, usage capture where supported.

Exit: real repository BugFix flow completes with evidence.

## M5 — Multi-driver Coding

Deliver Claude Code, OpenCode, compatible APIs/custom HTTP/local models, role/capability routing, fallback rules, context compiler, cost/usage.

Exit: same `.roflock` runs successfully with at least two materially different driver profiles.

## M6 — Roflock Studio

Deliver local daemon, Code/Diagram/Run/Evidence, Approval Inbox, driver/project settings, accessible monitoring.

Exit: developer can configure repository and execute reference BugFix without terminal after installation.

## M7 — Self-hosted Team Control Plane

Deliver multi-user, RBAC, shared projects/workflows/approvals, organization policy, Postgres adapter, central evidence/audit, runners, optional SSO integrations.

Exit: small team can self-host without mandatory Roflock Cloud.

## M8 — Registry and Extension Ecosystem

Deliver package manifest, client/server, publish/install, permission inspection, driver/domain-pack SDK, trust groundwork.

Exit: third party can publish/install reusable package using public contracts only.

## M9 — v1 Stability

Deliver compatibility suites, security hardening, fuzz/property testing, cross-platform CI, migrations, docs, packaging, benchmark fixtures.

Exit: stable v1 criteria are met.

---

# 51. Reference coding workflows

## Bug fix

```roflock
flow BugFix {
  Reproduce
    -> Investigator
    -> RegressionTest
    -> Builder
    -> Verify

  Verify.fail
    -> Builder { max 3 }

  Verify.pass
    -> Reviewer

  Reviewer.changes
    -> Builder { max 2 }

  Reviewer.approve
    -> Approval

  Approval.approve -> Done
  Approval.reject  -> Cancelled
}
```

Required evidence:

- reproduction;
- regression test fails before fix;
- patch;
- regression test passes after fix;
- required existing tests pass;
- reviewer verdict;
- human acceptance where configured.

## Feature

```text
Outcome Contract
→ Architect
→ Plan Critic
→ Test Designer
→ Builder
→ Deterministic Checks
→ Parallel Review
→ Join
→ Independent Verification
→ Human Acceptance
```

## Security fix

```text
Threat/Issue
→ Reproduce
→ Remediation Plan
→ Builder
→ Security Checks
→ Regression Checks
→ Independent Security Review
→ Human
```

---

# 52. Public alpha product boundary

A public alpha must provide a complete local coding workflow, not merely language syntax.

Required:

- language/compiler/validator;
- local runtime;
- durable events;
- repository/worktree;
- deterministic command/check runner;
- at least Codex driver;
- at least one additional driver or compatible API path;
- human approval;
- evidence;
- CLI;
- local Studio basic Code/Run/Evidence;
- safe pause/cancel/recovery;
- documentation/examples.

Not required for first alpha:

- polished team control plane;
- full registry;
- non-coding domain packs;
- distributed multi-region execution;
- advanced organization analytics;
- sophisticated long-term memory;
- automatic merge/deploy.

---

# 53. End-to-end acceptance scenario

Reference scenario uses a deliberately faulty sample repository.

```bash
roflock run .roflock/bugfix.roflock \
  --task "Fix duplicate payment processing"
```

Expected:

1. repository validates;
2. isolated worktree is created;
3. reproduction records evidence;
4. regression test fails before fix;
5. writer edits allowed files;
6. deterministic test runs;
7. failed attempt loops with concrete evidence;
8. later attempt passes;
9. independent readonly reviewer evaluates patch + evidence;
10. reviewer may request bounded changes;
11. human approval is requested;
12. approval completes task;
13. evidence bundle is exportable;
14. forced daemon restart does not lose confirmed progress;
15. no two writers own worktree simultaneously;
16. protected effects cannot bypass policy.

This is the primary integration test until broader suites exist.

---

# 54. Test strategy

## Language

- parser unit tests;
- invalid syntax fixtures;
- AST snapshot tests;
- formatter round-trip tests;
- fuzz/property tests later.

## Compiler/IR

- valid/invalid fixtures;
- semantic hash stability;
- migration fixtures;
- unreachable/dead-end cases;
- cycle/SCC cases;
- artifact type cases;
- approval dominance cases;
- writer conflict cases.

## Runtime

- deterministic fake driver;
- scheduler transition tests;
- loop exhaustion;
- join/fan-out;
- idempotency;
- cancellation;
- crash injection;
- process reconciliation.

## Repository

- temporary Git repos;
- dirty tree;
- worktree lifecycle;
- concurrent writer lease;
- interrupted writer;
- patch/diff capture.

## Drivers

Conformance suite: detection, auth health, invocation, structured event stream, readonly/write truthfulness, cancellation behavior, unknown outcome, usage, resume if claimed.

## Security

Negative tests for out-of-scope writes, secret exposure, forbidden network, stale approval reuse, unsafe package effect, prompt-based permission escalation, writer race, cancel/stop race.

## UI

Playwright for workflow editing/diagnostics, start run, live state, approval, evidence, and reconnect after daemon restart.

---

# 55. Stable v1 release criteria

## Build/reproducibility

- clean clone installs with documented prerequisites;
- build/typecheck/tests pass;
- no proprietary Roflock infrastructure required.

## Language

- Language v1 spec published;
- Graph IR v1 spec published;
- compatibility fixtures maintained;
- diagnostics stable enough for tooling.

## Runtime

- durable event recovery tested;
- loop bounds enforced;
- writer safety enforced;
- run control reliable;
- confirmation/approval durable;
- evidence export complete.

## Coding

- at least two production-quality coding agent/provider paths;
- deterministic check runner;
- real BugFix and Feature fixtures;
- provider capability disclosure truthful.

## Open source

- no hidden license checks disabling core functionality;
- self-hosting documented for available server surfaces;
- data export documented;
- security boundary code inspectable;
- extension contracts documented.

## Security

- threat model published;
- private vulnerability reporting available;
- security-sensitive/adversarial tests green.

## UX

- CLI usable independently;
- Studio usable locally;
- accessibility baseline passed;
- no misleading provider status/cost/quota claims.

## Documentation

- quick start;
- language guide;
- runtime architecture;
- driver guide;
- security model;
- contribution docs;
- working examples.

---

# 56. Product metrics

Open-source health:

- time to first successful `roflock check`;
- time to first successful run;
- workflow compile success after first edit;
- stars/forks/contributors;
- external packages/drivers;
- repeat active local runs.

Runtime quality:

- recovery success;
- duplicate invocation incidents;
- unbounded-loop incidents (target zero for validated graph);
- writer-conflict incidents;
- evidence completeness;
- cancellation/reconciliation success.

Workflow effectiveness:

- task success;
- retries;
- deterministic test pass rate;
- cost/time;
- human request-change/rejection;
- review findings by role/model.

Do not optimize superficial agent count or graph complexity.

---

# 57. AI coding harness development protocol

Roflock will be built substantially with AI coding harnesses. Development must be structured so agents work safely and verifiably.

## 57.1 Source of truth

Coding harness receives:

1. this PRD;
2. current RFCs/ADRs;
3. `AGENTS.md`;
4. exactly one atomic ticket;
5. repository state.

It must not infer an undocumented product redesign.

## 57.2 One task at a time

Every implementation task has clear ID, scope, out-of-scope, dependencies, acceptance criteria, required tests, and affected packages where known.

## 57.3 Working sequence

```text
Read task
→ inspect relevant code
→ plan minimal change
→ implement
→ add/update tests
→ run targeted tests
→ run required broader verification
→ inspect diff
→ commit task
```

Do not perform unrelated cleanup merely because it is convenient.

## 57.4 Commit discipline

Recommended baseline:

- one ticket = one logical commit;
- commit message begins with ticket ID;
- no generated `Co-authored-by` trailers;
- do not push unless explicitly instructed;
- keep worktree clean after completed task where possible;
- do not rewrite unrelated history.

## 57.5 Verification hierarchy

Prefer:

1. deterministic test;
2. typecheck/static analysis;
3. integration test;
4. fixture assertion;
5. manual/model review only where deterministic verification cannot establish result.

An implementing agent's statement that a task is correct is not acceptance evidence.

## 57.6 Scope protection

AI harness must not silently change public syntax, weaken validator checks, remove security gates, add paid/proprietary gating, introduce provider-specific Graph IR semantics without RFC, treat prompts as enforcement boundaries, or substitute mocks when a ticket requires real integration.

## 57.7 Public contract changes

Language/Graph IR/API changes require matching docs/fixtures and the appropriate RFC. Durable internal architecture decisions require ADR.

---

# 58. Ticket quality standard

Good ticket example:

```text
RF-M1-011 — Execute conditional edge after node outcome

Goal
Select exactly one valid outgoing edge after a node finishes.

Scope
runtime-core edge selector only.

Acceptance
- pass selects Tests.pass -> Reviewer
- fail selects Tests.fail -> Builder
- unknown outcome returns typed runtime error
- priority tie follows deterministic contract
- unit tests added

Out of scope
loops, persistence, real agents

Verification
pnpm --filter @roflock/runtime-core test
pnpm typecheck
```

Bad ticket:

```text
Build the runtime.
```

---

# 59. Initial implementation sequence

```text
M0-INTEGRATE
  ↓
M1-CONTRACTS
  ↓
M1-EVENTS
  ↓
M1-STATE-MACHINE
  ↓
M1-SCHEDULER
  ↓
M1-FAKE-DRIVER
  ↓
M1-CHECK-RUNNER
  ↓
M1-LOOPS
  ↓
M1-HUMAN
  ↓
M1-CLI-RUN
  ↓
M2-PERSISTENCE
  ↓
M2-RECOVERY
  ↓
M2-REPOSITORY
  ↓
M2-EVIDENCE
```

Do not begin broad real-provider integration until deterministic reference runtime proves graph semantics.

---

# 60. Open questions

These do not block M1 unless a ticket directly depends on them.

1. Final pnpm/lockfile version policy.
2. Parser/CST strategy for comment-preserving visual editing.
3. Browser-local Studio first vs Tauri wrapper timing.
4. Final Codex App Server vs CLI fallback details.
5. Claude Code structured event/permission mapping.
6. Default sandbox strategy per OS.
7. Minimum supported OS versions.
8. Registry signing/trust model.
9. SSO integration list.
10. Organization policy DSL vs structured config.
11. Artifact storage threshold between DB/files/object store.
12. Trademark governance.
13. Legal review of Apache-2.0 and third-party redistribution.

---

# 61. Decisions explicitly deferred

Do not delay M1–M4 for:

- non-coding domain packs;
- mobile client;
- complex knowledge graph;
- advanced cognitive memory;
- marketplace monetization;
- distributed multi-region scheduler;
- Kubernetes;
- graph database;
- automatic production deployment;
- autonomous merges;
- massive agent swarms.

---

# 62. Product launch narrative

Roflock should be demonstrated, not over-explained.

```roflock
flow BugFix {
  Builder -> Tests

  Tests.fail
    -> Builder { max 3 }

  Tests.pass
    -> Reviewer

  Reviewer.changes
    -> Builder { max 2 }

  Reviewer.approve
    -> Human
}
```

Then show:

```text
Builder / Codex            ✓
Tests                      ✗
Builder / Codex retry 2    ✓
Tests                      ✓
Reviewer / Claude          ✓
Human approval             ●
```

After approval:

```text
✓ required tests pass
✓ independent review passed
✓ human approved
✓ evidence bundle ready
```

Core launch message:

> **AI coding teams as code.**

Supporting line:

> Define the workflow. Run your agents. Prove the result.

---

# 63. Final product boundary

Roflock is strongest when this remains true:

```text
Readable workflow
      ↓
Compiler
      ↓
Static safety
      ↓
Durable runtime
      ↓
Existing coding agents
      ↓
Real repository checks
      ↓
Evidence
```

Roflock should not compete on the largest list of generic agent features.

It should become exceptionally good at making AI coding work structured, portable, controllable, safe, observable, verifiable, and reproducible.

That is the product this PRD authorizes the AI coding harness to build.

---

# Appendix A — Reference Roflock source

```roflock
goal "Fix duplicate payment processing" {
  require "duplicate webhook creates at most one payment"
    verify Tests.concurrent_duplicate

  require "payment regression suite remains green"
    verify Tests.payment

  forbid "breaking webhook signature validation"

  risk high
}

role Investigator {
  requires coding.read
  readonly
}

role Builder {
  requires coding.write
}

role Reviewer {
  requires coding.review
  readonly
}

agent InvestigatorAgent {
  role Investigator
  outcomes [done, blocked]
}

agent BuilderAgent {
  role Builder
  outcomes [done, blocked]
}

check Tests {
  run "pnpm test --filter payments"
}

agent ReviewerAgent {
  role Reviewer
  outcomes [approve, changes, blocked]
}

human Approval
terminal Done
terminal Cancelled

flow BugFix {
  entry InvestigatorAgent
  InvestigatorAgent.done -> BuilderAgent
  BuilderAgent.done -> Tests
  Tests.fail -> BuilderAgent { max 3 }
  Tests.pass -> ReviewerAgent
  ReviewerAgent.changes -> BuilderAgent { max 2 }
  ReviewerAgent.approve -> Approval
  ReviewerAgent.blocked -> Approval
  Approval.approve -> Done
  Approval.reject -> Cancelled
}
```

---

# Appendix B — Representative runtime event sequence

```json
{"sequence":1,"type":"run.started","runId":"run_01"}
{"sequence":2,"type":"node.started","nodeId":"BuilderAgent","attempt":1}
{"sequence":3,"type":"artifact.created","nodeId":"BuilderAgent","artifactId":"patch_01"}
{"sequence":4,"type":"node.completed","nodeId":"BuilderAgent","outcome":"done"}
{"sequence":5,"type":"edge.selected","from":"BuilderAgent","to":"Tests"}
{"sequence":6,"type":"node.started","nodeId":"Tests","attempt":1}
{"sequence":7,"type":"artifact.created","nodeId":"Tests","artifactId":"test_01"}
{"sequence":8,"type":"node.completed","nodeId":"Tests","outcome":"fail"}
{"sequence":9,"type":"loop.retry","nodeId":"BuilderAgent","attempt":2}
```

---

# Appendix C — Suggested root verification commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm --filter @roflock/language test
pnpm --filter @roflock/graph-ir test
pnpm --filter @roflock/runtime-core test
pnpm e2e
```

Exact scripts may evolve, but the repository should converge on one obvious root verification command before public alpha.

---

# Appendix D — Definition of done for an atomic ticket

A ticket is done only when:

- requested behavior is implemented;
- no out-of-scope redesign was introduced;
- new behavior has tests;
- relevant negative cases exist;
- targeted tests pass;
- required broader checks pass;
- docs/fixtures updated if public behavior changed;
- diff contains no unrelated changes;
- security/open-source boundary is not weakened;
- commit is created according to repository policy.

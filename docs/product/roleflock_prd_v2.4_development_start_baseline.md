# RoleFlock — Product Requirements Document

## Governed Agent Graph for Multi-model Software Engineering

**Product name:** RoleFlock  
**Brand endorsement:** RoleFlock by Mlola  
**Public domain:** https://roleflock.com  
**Local application:** http://127.0.0.1:4178  
**Tagline:** A governed, local-first agent graph for multi-model software engineering.  
**Document version:** 2.4 — Development Start Baseline  
**Date:** 26 July 2026  
**Primary user:** Individual developer or small engineering team using multiple AI subscriptions and APIs  
**Initial environment:** macOS, Git repositories, local CLIs, OpenAI-compatible APIs  
**Status:** Final development baseline — implementation may begin; changes require ADR, RFC, or verified blocker


### Version 2.4 development-start update

This version preserves the frozen graph, loop, control, approval, security, and brand architecture, then incorporates the final product decisions made immediately before development:

- the final product name is **RoleFlock**;
- the public product website is **roleflock.com**;
- the product endorsement is **RoleFlock by Mlola**;
- the local application continues to run on **http://127.0.0.1:4178**;
- RoleFlock and MemoSprout remain sibling products under Mlola;
- MemoSprout remains an optional future knowledge integration, not an MVP runtime dependency;
- all public names, internal examples, runtime paths, and documentation references now use RoleFlock.

The implementation baseline continues to require:

- real-time visibility of the active task, node, role, provider, configured model, permission profile, tool phase, elapsed time, cost, and quota;
- graceful pause, cooperative stop, forced termination, task cancellation, recovery, and workspace-wide emergency stop;
- typed agent confirmation requests for commands, writes, scope expansion, network access, dependency changes, budget, ambiguity, and external side effects;
- a unified Approval Inbox with safe deduplication, grouping, reusable scoped approval grants, expiry, revocation, and complete audit history;
- explicit protection against hidden work, self-reported model identity, accidental duplicate approvals, and silently continuing after a stop request;
- a smallest-sufficient-graph gate, selective cross-provider routing, and a decision that MemoSprout is not an MVP runtime dependency.

- an explicit task-intent chooser including Build a New Product, Add a Feature, Fix a Bug, Refactor, Investigate, and Review Existing Changes;
- optional PRD, implementation plan, API specification, wireframe, screenshot, and ticket inputs with authority classification and conflict resolution;
- a local-browser/local-daemon boundary for invoking user-installed Claude Code, Codex, and Cursor CLIs;
- subscription-first, capability-driven provider routing with custom APIs and local models as specialists, fallbacks, or explicit user choices;
- transparent disclosure of which selected context is sent to a configured cloud provider while RoleFlock operational data remains local;
- a staged knowledge roadmap: local knowledge items first, typed knowledge relationships later, and an optional full knowledge graph or MemoSprout integration after the runtime is proven.

---

## 0. Product Identity and Domain

### 0.1 Final public identity

```text
Product name:       RoleFlock
Endorsement:        RoleFlock by Mlola
Public website:     https://roleflock.com
Local application:  http://127.0.0.1:4178
Parent studio:       Mlola
```

### 0.2 Brand architecture

```text
Mlola
├── RoleFlock
│   └── Governed orchestration, execution, monitoring, verification,
│       cost control, and approval for AI coding agents
│
└── MemoSprout
    └── Optional long-term knowledge and learning layer for humans
        and AI agents
```

RoleFlock is a standalone product and must work without MemoSprout. MemoSprout may later be configured through the generic `KnowledgeStore` adapter.

### 0.3 Domain responsibilities

`roleflock.com` is the public product surface for:

- landing page;
- documentation;
- downloads and installation;
- release notes;
- pricing and licence information;
- privacy policy and terms;
- optional account and team control-plane features in later phases.

The public website does not directly execute local subscription CLIs or access local repositories. Those operations remain inside the local RoleFlock daemon.

### 0.4 Naming requirements

All new source code, package scopes, storage paths, environment variables, documentation, telemetry names, and UI labels must use `RoleFlock` or `roleflock`.

Examples:

```text
@roleflock/graph-core
@roleflock/provider-adapters
ROLEFLOCK_HOME
.roleflock/
roleflock.db
```

Identifiers from the previous working name must not be introduced into the new repository.

---

## 1. Executive Summary

RoleFlock is a local-first web application that coordinates multiple AI coding services as a governed software-engineering team.

Version 2.4 defines the product's central abstraction from a mostly linear role pipeline into a **durable agent graph**:

- **Nodes** perform bounded work.
- **Edges** select the next action from explicit conditions.
- **Loops** allow one node or subgraph to retry against objective feedback.
- **Branches** permit independent work in parallel.
- **Joins** combine evidence without hiding disagreement.
- **Shared state** preserves goals, artefacts, attempts, evidence, cost, and decisions.
- **Policies** enforce permissions, budgets, quota reserves, model compatibility, and escalation.
- **Human gates** retain authority over ambiguous semantics, policy exceptions, and merge approval.

A representative critical workflow is:

```text
Task
  ↓
Outcome Contract
  ↓
Chief Architect
  ↓
Plan Critic
  ├── PLAN_INVALID → Architect revision loop
  └── ACCEPTED
        ↓
Test Designer
        ↓
Human Plan Approval
        ↓
Primary Implementer
        ↓
Deterministic Checks
  ├── FAILED → Implementer fix loop
  └── PASSED
        ↓
Parallel Review Subgraph
  ├── Architecture Review
  ├── Security Review
  └── Regression Review
        ↓
Evidence Join
        ↓
Independent Verifier
  ├── FIXABLE → Implementer
  ├── PLAN_WRONG → Architect
  ├── AMBIGUOUS → Human Governor
  ├── HIGH_RISK → Final Judge
  └── PASS → Human Merge Approval
```

RoleFlock initially coordinates:

| Connection | Default responsibility |
|---|---|
| Claude Code subscription | Chief Architect and Planner |
| Cursor Agent subscription | Primary Implementer |
| Codex subscription | Independent Verifier and Final Judge |
| Custom Provider connection A, currently Qwen | Plan Critic and Broad Reviewer |
| Custom Provider connection B, currently Xiaomi MiMo | Test Designer and Low-cost Specialist |

Qwen and Xiaomi are editable examples, not hard-coded providers. Any compatible provider can be configured using provider name, protocol, base URL, API key, model IDs, custom headers, price cards, and optional quota endpoints.

RoleFlock supports feature development, bug fixing, refactoring, test improvement, performance work, security remediation, dependency updates, migrations, documentation, and read-only investigations.


At every moment, RoleFlock must make the active execution understandable in one sentence, for example:

```text
Planning — Chief Architect — Claude Opus 5 High
Read-only — Reading repository — 03:42 elapsed
```

The displayed model identity comes from the configured adapter and invocation record, never from the model describing itself. Every long-running operation is controllable from the UI and API. The user can pause at a safe boundary, stop the active node, cancel the task, or trigger an emergency stop. Agents can request confirmation through a typed, auditable interruption instead of asking informally inside a transcript.

The product is deliberately not an unbounded “agent swarm.” RoleFlock follows four operating rules:

1. **One primary writer per worktree.**
2. **Retry only with new evidence.**
3. **Use deterministic verification wherever possible.**
4. **Every loop has a stop condition, budget, and escalation route.**

---

## 2. Problem Statement

A developer may simultaneously subscribe to Claude, Codex, and Cursor while also owning credentials for one or more custom model endpoints, such as Qwen, Xiaomi MiMo, OpenRouter, Together, an internal gateway, or a self-hosted model. Each service has different strengths, interfaces, billing, quota windows, authentication, output formats, and tool permissions.

Without orchestration:

1. Work is duplicated across models.
2. Plans, implementations, and reviews are trapped in separate chat histories.
3. Multiple agents can overwrite the same files.
4. There is no reliable stage ownership or approval gate.
5. Subscription quota is consumed without a routing strategy.
6. API costs are difficult to attribute to a task or project.
7. A model may approve its own implementation.
8. It is difficult to reproduce why a change was made.
9. Provider outage or quota exhaustion interrupts work.
10. Sensitive code and credentials can be exposed to more models than necessary.

11. Users cannot always tell which role, provider, model, process, or tool is currently active.
12. Agent confirmation questions are often buried inside logs or terminal output.
13. Stop and cancel behaviour is inconsistent across CLIs and can leave orphaned processes or ambiguous repository state.
14. Repeated identical approval requests create friction, while overly broad auto-approval creates security risk.

RoleFlock solves this by establishing a single control plane, a common task state machine, structured hand-offs, independent verification, and a unified usage ledger.

---

## 3. Product Vision

> Give a developer the experience of managing a disciplined AI engineering team, while retaining local control of code, credentials, budgets, and final decisions.

The user should be able to write:

> “Add idempotent payment webhook handling to Denahku. This is a critical task. Keep actual API spend under $3 and require human approval before merge.”

RoleFlock should then:

1. inspect the project and applicable rules;
2. ask Claude to create a plan;
3. ask Qwen to challenge the plan;
4. ask MiMo to create an adversarial test matrix;
5. ask Cursor to implement in an isolated worktree;
6. run deterministic checks;
7. ask Qwen for broad review;
8. ask Terra for independent verification;
9. ask Sol for a final blocking-risk judgement;
10. stop for human approval;
11. display the complete cost, quota impact, evidence, and audit trail.

---

## 4. Product Principles

### 4.1 Role separation over model popularity

A model is selected because it fits a role, not merely because it is considered strongest overall.

### 4.2 One primary writer

Only one role may write to the active implementation worktree at a time. By default this is Cursor Grok 4.5 High.

### 4.3 Deterministic checks before model judgement

Lint, typecheck, unit tests, integration tests, build, migrations, and security scanners run before a reviewer is allowed to pass a task.

### 4.4 Independent verification

The model that implements a change cannot be the final reviewer of that change.

### 4.5 Local-first credentials and code

Subscription credentials and repository contents remain on the user’s machine unless the selected provider invocation requires sending relevant context to that provider.

### 4.6 Honest usage reporting

Every number must be labelled as one of:

- **Exact:** returned by an official API or provider event.
- **Metered locally:** captured by RoleFlock for invocations it initiated.
- **Estimated:** calculated from tokens, configured rates, or shadow pricing.
- **Manual:** entered or refreshed by the user.
- **Unknown:** unavailable from the provider.

### 4.7 Budget is a policy, not just a chart

Budget thresholds can prevent a stage from starting, select a cheaper fallback, or require approval.

### 4.8 Human merge authority

MVP never pushes or merges without explicit human approval.


### 4.9 No hidden work

The UI must always identify the active task, graph, node, role, configured provider/model, permission profile, process phase, and reason for waiting. Background execution cannot be represented only by a spinner.

### 4.10 Everything is interruptible

Every long-running invocation must expose pause, cooperative cancellation, forced termination, and recovery semantics. A stop request must be acknowledged immediately and reflected in durable state even when the provider process takes time to exit.

### 4.11 Confirmation is a first-class protocol

An agent that needs permission, clarification, additional scope, or budget emits a typed `ConfirmationRequest`. The orchestrator—not the model—decides whether an existing approval grant applies, whether the request must reach the user, and what execution may resume afterward.

### 4.12 Approval convenience must remain bounded

Identical safe requests can be grouped and approved together. Reusable approval grants require an explicit scope, fingerprint, risk ceiling, expiry, and revocation path. Destructive, secret-bearing, production, deployment, merge, push, authentication, payment, and migration actions remain per-occurrence approvals unless a future enterprise policy explicitly permits otherwise.

### 4.13 Smallest sufficient graph

RoleFlock chooses the least complex execution mode that can meet the outcome contract. More agents, providers, branches, and loops are not considered improvements unless evaluation evidence justifies them.


---

## 4A. Graph and Loop Engineering Foundation

### 4A.1 Why graphs are the primary abstraction

A linear chain can describe a happy path:

```text
Planner → Implementer → Reviewer
```

It cannot fully describe:

- what happens when the plan is wrong;
- which failure should return to which role;
- when two read-only reviews can run in parallel;
- how evidence is joined;
- how quota exhaustion changes model routing;
- when the system pauses for human input;
- how a task resumes after daemon failure;
- how a local retry differs from restarting the entire task.

RoleFlock therefore models work as a directed graph that may contain cycles.

### 4A.2 Core terminology

**Agent loop**  
A model observes context, calls tools, observes results, and repeats until its bounded node objective is complete.

**Verification loop**  
An executor's output is checked against tests, assertions, or a reviewer. Failed output returns with concrete evidence.

**Workflow graph**  
A versioned structure containing nodes, edges, branches, joins, cycles, policies, and terminal states.

**Node**  
One bounded unit of work. It can be a full agent, one model call, a command, a test, a router, a join, an external event, or human approval.

**Edge**  
A conditional transition between nodes.

**Shared state**  
Durable task data available across nodes, including contracts, artefacts, attempts, evidence, budgets, quota, and decisions.

**Harness**  
Runtime logic controlling model calls, context, tools, retries, and handoffs.

**Sandbox**  
Constrained execution environment containing the task worktree and allowed tools.

**Session**  
Append-only event history. A session is durable and is not equivalent to a model context window.

### 4A.3 Product principles added in v2.0

#### Graphs coordinate; loops converge

The graph controls global workflow. Loops operate locally inside a node or subgraph to reach a measurable condition.

#### Every loop needs an exit

A cycle is invalid unless it defines:

- objective;
- verifier;
- maximum attempts;
- maximum time;
- maximum actual or shadow cost;
- evidence requirement;
- escalation node.

#### Retry only with new evidence

Valid retry evidence includes:

- a failing test;
- reviewer finding;
- runtime log;
- browser assertion;
- database assertion;
- benchmark;
- human clarification;
- revised plan.

“Try again more carefully” does not count as new evidence.

#### Mix determinism and agency

Known operations remain deterministic. Models are used for judgement, planning, synthesis, debugging, and open-ended work.

```text
Good:
Agent implementation → real tests → read-only verifier → human approval

Bad:
Agent implementation → agent asks itself whether it is correct → agent says yes
```

#### Durable by default

Browser refresh, daemon restart, provider disconnection, model context reset, or lost subprocess must not destroy confirmed progress.

#### Human authority is explicit

Human decisions are graph nodes, not informal interruptions. They are durable, auditable, and resumable.


#### Control is outside the model

The model may request an action but cannot grant itself permission, hide its execution state, clear a stop request, extend its own budget, or decide that a human confirmation is unnecessary.

#### Provider diversity is selective

RoleFlock is provider-agnostic and cross-provider capable, but a task uses multiple providers only when this improves independence, capability, quota resilience, or cost. Provider count is not a quality metric.

### 4A.4 Graph domain model

```typescript
interface WorkflowGraph {
  id: string;
  name: string;
  version: number;
  taskTypes: TaskType[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  sharedStateSchema: JsonSchema;
  budgetPolicy: BudgetPolicy;
  quotaPolicy: QuotaPolicy;
  concurrencyPolicy: ConcurrencyPolicy;
  approvalPolicy: ApprovalPolicy;
}

interface WorkflowNode {
  id: string;
  type:
    | "agent"
    | "model_call"
    | "command"
    | "test"
    | "router"
    | "join"
    | "human_approval"
    | "context_compile"
    | "knowledge_retrieve"
    | "evidence_aggregate"
    | "external_event";

  roleId?: string;
  permissionProfileId?: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  loopPolicy?: LoopPolicy;
}

interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  condition: EdgeCondition;
  priority: number;
  handoffSchema?: JsonSchema;
}
```

### 4A.5 Node types

#### Agent node

A complete tool-using agent session with a bounded objective and local loop.

#### Model-call node

One structured request with no autonomous tool loop. Useful for classification, summarisation, critique, and extraction.

#### Command node

A predefined command such as lint, typecheck, build, migration dry run, or static analysis.

#### Test node

Runs a test contract and maps results to acceptance criteria.

#### Router node

Selects an edge based on durable state and deterministic policy.

#### Join node

Waits for required branches, deduplicates findings, preserves disagreement, and emits a combined evidence bundle.

#### Human approval node

Durably pauses execution. Browser closure or daemon restart must not lose the pending decision.

### 4A.6 Edge conditions

```typescript
type EdgeCondition =
  | "always"
  | "passed"
  | "failed"
  | "tests_passed"
  | "tests_failed"
  | "changes_required"
  | "plan_invalid"
  | "risk_high"
  | "ambiguous"
  | "human_approved"
  | "human_rejected"
  | "quota_low"
  | "budget_warning"
  | "budget_exceeded"
  | "provider_unavailable"
  | "timeout";
```

### 4A.7 Loop policy

```typescript
interface LoopPolicy {
  objective: string;
  verifierNodeId: string;
  maxAttempts: number;
  maxDurationMinutes: number;
  maxActualCost?: number;
  maxShadowCost?: number;
  requireNewEvidence: boolean;
  feedbackSchema: JsonSchema;
  onExhausted: "escalate" | "pause" | "fail";
  escalationNodeId?: string;
}
```

### 4A.8 Failure classification and routing

```typescript
type FailureClass =
  | "implementation_error"
  | "missing_test"
  | "plan_error"
  | "requirement_ambiguity"
  | "environment_failure"
  | "provider_failure"
  | "policy_violation"
  | "budget_exceeded"
  | "unfixable";
```

Default routes:

```text
implementation_error  → Primary Implementer
missing_test          → Test Designer or Implementer
plan_error            → Chief Architect
requirement_ambiguity → Human Governor
environment_failure   → Deterministic retry or pause
provider_failure      → Provider fallback router
budget_exceeded       → Human budget approval
unfixable             → Block task
```

### 4A.9 Parallelism

Parallelism is allowed only for sufficiently independent work.

Good candidates:

- architecture, security, and regression review;
- competing root-cause investigations;
- independent module inspection;
- multiple read-only test-design perspectives.

Poor candidates:

- two writers in one worktree;
- tightly coupled migrations;
- schema and service edits performed independently;
- trivial tasks where coordination costs exceed benefit.

```typescript
interface ParallelisationPolicy {
  maxConcurrentReadNodes: number;
  maxConcurrentWriteNodesPerWorktree: 1;
  maxParallelActualCost?: number;
  joinStrategy: "all" | "quorum" | "first_success";
}
```

### 4A.10 Graph validation

RoleFlock rejects a graph containing:

- two parallel writers on one worktree;
- a cycle without loop policy;
- no terminal node;
- a pass path bypassing required checks;
- a merge path without human approval;
- an unbounded retry;
- an edge referencing unavailable state;
- a provider fallback without compatible capabilities;
- a final evaluator identical to the sole implementer without an independent gate.


---

## 4B. Execution Control, Monitoring, and Human Confirmation

### 4B.1 Control-plane invariant

Every running unit has exactly one durable `ActiveExecution` record containing:

```typescript
interface ActiveExecution {
  taskId: string;
  graphRunId: string;
  nodeRunId: string;
  attempt: number;
  roleId?: string;
  providerConnectionId?: string;
  configuredModelId?: string;
  permissionProfileId?: string;
  executionPhase: ExecutionPhase;
  processState: ProcessState;
  startedAt: string;
  lastHeartbeatAt: string;
  currentAction?: string;
  currentTool?: string;
  waitingReason?: string;
  actualCostSoFar?: number;
  shadowCostSoFar?: number;
  quotaSnapshotRef?: string;
  canPause: boolean;
  canStop: boolean;
  canForceTerminate: boolean;
}
```

The UI renders this record prominently. Model identity is adapter-supplied and immutable for the invocation.

### 4B.2 Execution phases

```typescript
type ExecutionPhase =
  | "preparing_context"
  | "waiting_for_provider"
  | "reasoning"
  | "reading_repository"
  | "calling_tool"
  | "running_command"
  | "writing_files"
  | "running_tests"
  | "reviewing_diff"
  | "waiting_for_confirmation"
  | "pausing"
  | "stopping"
  | "finalising"
  | "recovering";
```

Example status lines:

```text
Planning — Chief Architect — Claude Opus 5 High
Read-only — Reading repository — 03:42 elapsed

Implementation — Primary Implementer — Grok 4.5 High via Cursor
Workspace writer — Running pnpm test — attempt 2 of 2

Waiting for confirmation — Primary Implementer
Requests permission to update package-lock.json
```

### 4B.3 Process heartbeat and stale detection

Each adapter or child process emits a heartbeat. The daemon distinguishes:

- actively producing output;
- waiting on provider response;
- running a tool;
- intentionally paused;
- waiting for confirmation;
- unresponsive;
- disconnected but recoverable;
- terminated.

A stale threshold creates an alert but does not automatically duplicate a paid invocation. The user can inspect, wait, stop, or recover.

### 4B.4 Pause, stop, cancel, and emergency stop

These actions are deliberately different:

| Action | Meaning | Result |
|---|---|---|
| **Pause task** | Stop scheduling new nodes and request the active node to reach the next safe boundary | Task becomes `PAUSED`; state and worktree remain resumable |
| **Stop active node** | Send cooperative cancellation to the current provider/process | Node becomes `STOPPING`, then `INTERRUPTED` or `STOPPED` |
| **Force terminate** | Kill the local process after a grace period | Node becomes `INTERRUPTED_UNCLEAN`; recovery inspection is mandatory |
| **Cancel task** | Prevent all future graph transitions | Task becomes `CANCELLING`, then `CANCELLED`; artefacts and worktree are preserved by default |
| **Emergency stop workspace** | Block new starts, revoke runtime leases, terminate all child processes | Workspace enters `EMERGENCY_STOPPED` until acknowledged and reconciled |

No stop action silently resets or discards edits. The UI shows whether files changed before termination and offers inspect, keep worktree, create patch, revert RoleFlock-owned changes, or resume from a safe checkpoint.

### 4B.5 Safe boundaries

A graceful pause can wait for an atomic boundary such as:

- completion of the current provider response;
- completion of one allowlisted command;
- a file write transaction finishing;
- a test process exiting;
- a structured artefact being persisted.

The UI must show `Pause requested — waiting for current command to finish`, rather than appearing unresponsive.

### 4B.6 Control command lifecycle

```typescript
type ControlCommandType =
  | "pause_task"
  | "resume_task"
  | "stop_node"
  | "force_terminate_node"
  | "cancel_task"
  | "emergency_stop_workspace";

type ControlCommandStatus =
  | "requested"
  | "acknowledged"
  | "in_progress"
  | "completed"
  | "failed"
  | "superseded";
```

Every command records requester, timestamp, reason, target, acknowledgement, completion, and resulting state.

### 4B.7 Typed confirmation requests

Agents and deterministic nodes may request confirmation only through this schema:

```typescript
interface ConfirmationRequest {
  id: string;
  taskId: string;
  nodeRunId: string;
  attempt: number;
  requestType:
    | "clarify_requirement"
    | "expand_scope"
    | "write_path"
    | "run_command"
    | "network_access"
    | "dependency_change"
    | "database_change"
    | "external_side_effect"
    | "provider_switch"
    | "additional_budget"
    | "policy_exception";
  title: string;
  rationale: string;
  exactAction: StructuredAction;
  affectedPaths?: string[];
  commandPreview?: string;
  diffPreviewRef?: string;
  estimatedAdditionalCost?: number;
  riskClass: "low" | "medium" | "high" | "critical";
  proposedResumeEdge: string;
  expiresAt?: string;
  fingerprint: string;
}
```

The graph pauses at a safe boundary while the request is pending. A natural-language question in model output does not by itself grant permission or block execution; the adapter must surface a validated confirmation request.

### 4B.8 Approval Inbox

The Approval Inbox is a first-class navigation item and global drawer. It displays:

- request title and type;
- originating task, node, role, provider, and configured model;
- why confirmation is needed now;
- exact command, paths, diff, or external effect;
- current and remaining budget;
- risk level;
- what happens on approve, reject, or request changes;
- whether the request matches an existing grant;
- how many similar requests are grouped.

User actions:

- Approve once.
- Reject.
- Request changes or clarification.
- Approve all currently grouped identical requests.
- Create a scoped approval grant.
- Edit the proposed scope before granting.
- Pause or cancel the originating task.

### 4B.9 Approval request fingerprinting and grouping

Requests can be grouped only when their normalised security-relevant fields match:

- request type;
- project and repository;
- worktree or allowed task scope;
- permission profile;
- command executable and argument template;
- affected path pattern;
- provider/model capability when relevant;
- network destination when relevant;
- maximum cost and risk class;
- expected side-effect class.

Presentation-only text does not affect the fingerprint. Any material difference produces a separate request.

Example:

```text
6 identical requests
Run `pnpm test --filter payments` in six read-only verifier nodes
[Approve all 6 once] [Create task-scoped grant] [Review individually]
```

### 4B.10 Approval grants

```typescript
interface ApprovalGrant {
  id: string;
  createdBy: string;
  sourceRequestId: string;
  scope:
    | "single_request"
    | "node_attempt"
    | "task"
    | "task_request_type"
    | "repository_session"
    | "exact_fingerprint";
  fingerprint: string;
  projectId: string;
  repositoryId: string;
  taskId?: string;
  allowedPathPatterns?: string[];
  allowedCommandTemplates?: string[];
  maximumRisk: "low" | "medium" | "high";
  maximumAdditionalCost?: number;
  maximumApplications?: number;
  applicationsUsed: number;
  expiresAt: string;
  status: "active" | "exhausted" | "expired" | "revoked";
}
```

Before showing a new request, RoleFlock evaluates active grants. A request is auto-applied only when all material fields fit the grant. The audit log still creates an `approval.auto_applied` event and the UI shows which grant was used.

### 4B.11 Actions that cannot use reusable grants in MVP

The following always require a fresh, explicit confirmation:

- reading or exposing secrets;
- pushing or merging;
- deployment or production access;
- destructive file, Git, database, or infrastructure actions;
- authentication or authorisation policy changes;
- payment and credit mutations;
- database migrations with write effects;
- public API breaking changes;
- disabling required tests or security controls;
- extending a hard budget beyond the configured critical threshold.

### 4B.12 Approval lifecycle

```typescript
type ApprovalStatus =
  | "pending"
  | "grouped"
  | "approved"
  | "rejected"
  | "changes_requested"
  | "auto_applied"
  | "expired"
  | "withdrawn"
  | "superseded"
  | "cancelled";
```

Approvals are idempotent. Double-clicking approve or receiving duplicate network requests cannot apply an action twice.

### 4B.13 Smooth resumption

After approval:

1. Persist the approval decision.
2. Revalidate graph state, worktree hash, request fingerprint, budget, and provider health.
3. Acquire required runtime and writer leases.
4. Resume only the blocked node or selected edge.
5. Stream `approval.applied` and `node.resumed` events.

If material state changed while waiting, RoleFlock invalidates the approval and asks again with a clear explanation.

### 4B.14 Transparency requirements

The UI must never merely say `Agent working`. It must show as much of the following as the adapter can truthfully provide:

- current role;
- configured provider and model;
- invocation and attempt;
- permission profile;
- current execution phase;
- current tool or command;
- elapsed time and last heartbeat;
- token usage and cost so far;
- quota confidence;
- active worktree and write lock;
- pending stop/pause request;
- pending confirmation;
- next possible graph transitions.

---


## 4C. Local Web Application, CLI Execution, and Data Boundary

### 4C.1 Runtime topology

The browser is a local control surface. It never invokes a CLI directly.

```text
Public website
https://roleflock.com
= landing page, documentation, download, pricing, release notes

Local application
http://127.0.0.1:4178
        │
        │ HTTP + SSE/WebSocket
        ▼
RoleFlock local daemon
        ├── invokes user-installed Claude Code
        ├── invokes Codex App Server or CLI
        ├── invokes Cursor CLI
        ├── calls configured Custom Provider APIs
        ├── manages worktrees and process trees
        ├── stores durable state locally
        └── enforces permissions, approvals, budgets, and stop controls
```

The local daemon must bind to `127.0.0.1` by default. The public website cannot access repositories, local CLIs, credentials, or the local database.

### 4C.2 User-owned authentication

RoleFlock uses authentication already established by the user's installed CLI whenever supported.

```text
Claude Code → user's Claude account or configured API authentication
Codex       → user's ChatGPT/Codex account or configured API authentication
Cursor      → user's Cursor account
Custom API  → user-supplied credential stored in the OS keychain
```

RoleFlock must not request or store account passwords. CLI-managed OAuth/session credentials remain owned by the corresponding CLI.

### 4C.3 Local storage

All RoleFlock operational data is local in MVP:

```text
~/.roleflock/
├── roleflock.db
├── config/
├── events/
├── artefacts/
├── logs/
├── knowledge/
├── evaluations/
├── provider-metadata/
├── backups/
└── worktrees/
```

Sensitive credentials are stored in the OS keychain, not in `roleflock.db`, logs, task artefacts, or project folders.

### 4C.4 Repository access

A user explicitly registers a repository folder. RoleFlock may:

- read the registered repository according to project policy;
- create isolated task worktrees;
- write only through the current writer lease;
- run configured commands;
- inspect Git state.

RoleFlock may not implicitly access unrelated repositories, parent folders, home-directory secrets, SSH credentials, cloud credentials, or denied paths. Real paths and symlinks must be resolved before access checks.

### 4C.5 Honest cloud-model disclosure

RoleFlock and Mlola do not receive or store the user's repository in the local-first MVP. When a cloud model is invoked, selected task and repository context is sent to the provider configured by the user.

Approved positioning:

> Your repositories, task history, credentials, and execution state stay on your machine. RoleFlock sends only selected context to the model providers you choose.

Prohibited positioning unless all active models are local:

> Your code never leaves your device.

### 4C.6 Provider disclosure grants

During onboarding or project setup, users may create grants such as:

```text
Always allow Anthropic for this project
Always allow OpenAI for this project
Always allow Cursor for this project
Ask before using any other cloud provider
Local models only
```

A compact invocation status remains visible:

```text
Planning · Chief Architect
Claude Code · Opus · High effort
Selected context: 12 files · estimated 24.8K tokens
Provider: Anthropic
[Inspect Context] [Pause] [Stop]
```

The Context Inspector exposes a disclosure manifest containing provider, configured model, selected files or summaries, exclusions, token estimate, purpose, and policy decision. Routine invocations covered by a project grant must not create repetitive blocking privacy modals.

---

## 5. Goals and Success Metrics

### 5.1 Product goals

- Coordinate subscription-based CLIs and API-based models in one workflow.
- Make every task observable from request to final review.
- Attribute cost and quota usage to project, task, role, model, and invocation.
- Prevent conflicting writes and unsafe commands.
- Support provider fallback without silently changing quality expectations.
- Preserve structured evidence for every verdict.
- Make workflow configuration accessible through UI rather than scripts only.
- Make every active execution visible, controllable, interruptible, and recoverable.
- Make confirmation and approval flows fast enough for daily use without weakening permission boundaries.
- Use the smallest sufficient graph and selectively use cross-provider verification.

### 5.2 MVP success metrics

| Metric | Target |
|---|---:|
| Successful provider connection tests | ≥ 95% |
| Tasks with complete stage audit trail | 100% |
| Writer collisions | 0 |
| Critical tasks merged without final human approval | 0 |
| API invocations with captured token usage | ≥ 98% |
| Deterministic test results attached before final verdict | 100% |
| Quota values carrying a confidence label | 100% |
| Workflow resumed after process restart | 100% |
| Median time to create a task | < 60 seconds |
| User can identify blocking stage from dashboard | < 10 seconds |
| User can identify active role, provider, model, and action | < 3 seconds |
| Stop request visibly acknowledged | < 1 second |
| Orphaned child processes after completed stop/cancel | 0 |
| Duplicate approval action applications | 0 |
| Eligible identical approvals correctly grouped | 100% |
| Sensitive actions auto-approved by reusable grant | 0 |

---

## 6. Target Users

### 6.1 Primary persona: Multi-model solo developer

- Owns multiple AI subscriptions.
- Uses local repositories and Git worktrees.
- Wants high-quality coding outcomes without paying API rates for every stage.
- Needs clear control over permissions, usage, and cost.
- Is comfortable installing CLIs but does not want to maintain orchestration scripts.

### 6.2 Secondary persona: Small engineering team

- Wants shared workflow templates and audit records.
- Uses provider team plans where available.
- Needs per-project or per-member spending limits.
- Requires central policy but local execution.

### 6.3 Future persona: AI tooling platform team

- Wants RoleFlock as a control plane or SDK.
- Integrates custom models, queues, sandboxes, and evaluation systems.

---

## 7. Scope

### 7.1 MVP in scope

- Local web application and local orchestration daemon.
- macOS first; Linux next.
- Git repositories and Git worktrees.
- Claude Code CLI adapter.
- Cursor Agent CLI adapter.
- Codex CLI or Codex app-server adapter.
- Generic OpenAI-compatible API adapter.
- Unlimited custom provider connections with configurable provider name, base URL, API key, protocol, model IDs, headers, pricing, and quota source.
- Qwen and Xiaomi MiMo supplied only as editable example connections.
- Fast, Standard, and Critical workflow templates.
- Custom workflows with ordered stages.
- Task queue, task detail, live logs, diffs, tests, review reports.
- Role and model configuration.
- Permission profiles.
- Cost ledger and budget policy.
- Quota dashboard with confidence labels.
- Human approval gates.
- Global Approval Inbox, request grouping, scoped approval grants, expiry, and revocation.
- Real-time active execution identity and phase monitoring.
- Graceful pause, cooperative stop, forced termination, task cancel, emergency stop, and recovery.
- Retry, fallback, pause, cancel, and resume.
- JSON-schema validated stage outputs.
- Local SQLite for MVP, PostgreSQL optional later.
- Secrets stored in OS keychain.
- Exportable task bundle.

### 7.2 Out of scope for MVP

- Fully hosted SaaS execution of personal subscription CLIs.
- Automatic merge to protected production branches.
- Mobile-native application.
- Kubernetes multi-tenant agent execution.
- Provider browser scraping as a core dependency.
- Guaranteed exact account-wide quota for providers without a supported machine-readable interface.
- Autonomous deployment to production.
- Billing end users for model usage.
- Training or fine-tuning models.
- MemoSprout as a required runtime dependency; integration remains an optional post-MVP adapter.

---

## 8. Recommended Model Roles

## 8.1 Claude Opus 5 High — Chief Architect

**Mission:** Convert business requirements and repository context into a precise, implementation-ready plan.

**Inputs**

- Task brief.
- Project instructions.
- Repository map.
- Relevant architecture documents.
- Selected files.
- Previous decisions or optional MemoSprout context.
- Risk mode and budget constraints.

**Outputs**

- Problem interpretation.
- Proposed architecture.
- Files likely affected.
- Ordered implementation steps.
- Acceptance criteria.
- Required tests.
- Risk register.
- Out-of-scope items.
- Questions or blockers.

**Permissions**

- Read repository.
- Read Git history.
- Run non-mutating discovery commands.
- No source edits.
- No commit, push, network mutation, or deployment.

**Why this role**

Planning benefits from deep reasoning and broad context, while preventing the planner from prematurely changing code.

---

## 8.2 Plan Critic and Broad Reviewer — Configurable Custom Model

**Default model example:** Qwen 3.8 Max Review through a user-defined Custom Provider connection.

**Mission:** Challenge assumptions and identify omissions before and after implementation.

**Pre-implementation review**

- Detect incorrect repository assumptions.
- Find dependencies or files omitted by Claude.
- Identify missing acceptance criteria.
- Check whether the plan is needlessly complex.
- Verify alignment with project conventions.

**Post-implementation review**

- Review the entire diff at a broad architectural level.
- Check consistency across modules.
- Identify accidental scope expansion.
- Detect maintainability and backwards-compatibility risks.

**Permissions**

- Read-only.
- No direct edits.
- No final authority.

**Notes**

The Plan Critic role is not coupled to Qwen. The user may map it to any configured model. `qwen3.8-max-review` is merely the initial model alias in the example workspace. Model metadata comes from the Custom Provider configuration or an optional model-list endpoint.

---

## 8.3 Test Designer and Low-cost Specialist — Configurable Custom Model

**Default model example:** Xiaomi MiMo v2.5 Pro through a user-defined Custom Provider connection.

**Mission:** Perform bounded, repeatable work that can be verified cheaply.

**Default tasks**

- Generate boundary and invalid-input tests.
- Generate adversarial test matrices.
- Analyse logs or test failures.
- Propose unit tests.
- Produce isolated patch suggestions.
- Summarise implementation or review evidence.
- Generate structured fixtures and cases.

**Permissions**

- Read relevant specification and selected files.
- Return structured test plan or patch proposal.
- No direct write to the primary worktree in MVP.

**Why this role**

MiMo’s low API price makes it appropriate for frequent, narrow calls. The implementation still remains under the primary writer’s control.

---

## 8.4 Cursor Grok 4.5 High — Primary Implementer

**Mission:** Implement the approved plan in an isolated Git worktree.

**Responsibilities**

- Read the approved plan and test matrix.
- Modify only permitted paths.
- Add or update tests.
- Run allowed commands.
- Produce an implementation report.
- Apply review fixes.
- Never merge or push without explicit permission.

**Permissions**

- Workspace write.
- Allowed package manager, test, build, and Git inspection commands.
- Denied access to secrets and destructive shell commands.
- No direct write to the base branch.

**Single-writer rule**

Cursor is the sole primary writer for the active task. Alternative implementers must use separate worktrees and require an explicit hand-off.

---

## 8.5 GPT-5.6 Terra Medium — Independent Verifier

**Mission:** Decide whether implementation evidence satisfies the plan and acceptance criteria.

**Checks**

- Acceptance-criteria traceability.
- Correctness and regression risk.
- Missing tests.
- Authorisation and validation.
- Race conditions and transactions.
- Data integrity.
- Error handling.
- Backwards compatibility.
- Unrelated changes.
- Test credibility.

**Permissions**

- Read repository and diff.
- Run safe deterministic tests.
- No source edits.
- Verdict: `PASS`, `CHANGES_REQUIRED`, or `BLOCKED`.

---

## 8.6 GPT-5.6 Sol High — Final Judge

**Mission:** Perform a final high-confidence blocking-risk review for critical changes.

**Invoked when**

- Authentication or authorisation changes.
- Payments, balances, credits, or billing changes.
- Database migration or destructive data operation.
- Public API breaking change.
- Concurrency or distributed systems logic.
- Infrastructure or deployment change.
- Reviewers disagree.
- User manually requests final review.

**Output**

- Final verdict.
- Blocking reasons.
- Residual risks.
- Required human checks.
- Rollback considerations.

**Permissions**

- Read-only.
- No implementation.
- Cannot override failed deterministic tests.


---

## 8.7 Custom Provider and Role Mapping

Roles and providers are independent concepts.

```text
Role
  ↓ selects
Model configuration
  ↓ belongs to
Provider connection
  ↓ uses
Protocol + base URL + secret
```

Example:

```text
Plan Critic
  → Qwen 3.8 Max Review
  → Qwen Gateway
  → OpenAI-compatible endpoint

Test Designer
  → MiMo v2.5 Pro
  → Xiaomi Gateway
  → OpenAI-compatible endpoint
```

The user may later change the mapping to:

```text
Plan Critic
  → another review model
  → OpenRouter Production

Test Designer
  → a self-hosted model
  → Local vLLM
```

No workflow migration is required because the workflow references the role, not the provider brand.

### Required role-mapping controls

- Default model.
- Fallback model chain.
- Allowed provider connections.
- Capability requirements.
- Maximum context and output.
- Cost ceiling.
- Quota reserve.
- Data-residency or privacy constraint.
- Manual override per task.
- Health-based automatic fallback.

---


## 9. Workflow Modes

### 9.0 Graph Necessity Gate

Before launch, RoleFlock selects the smallest sufficient execution mode:

```typescript
type ExecutionMode =
  | "direct"
  | "simple_loop"
  | "fixed_graph"
  | "critical_graph";
```

- **Direct:** one agent plus deterministic checks.
- **Simple loop:** one writer and one verifier with a bounded fix loop.
- **Fixed graph:** explicit planning, implementation, review, and approval nodes.
- **Critical graph:** independent critique, specialised verification, strict approvals, and optional final judge.

The gate considers risk, diff scope, independent branches, permission changes, migration, external side effects, and required verification. Users can inspect and override the recommendation before starting.

Default complexity budgets:

| Mode | Maximum agent nodes | Maximum parallel agents | Maximum fix attempts |
|---|---:|---:|---:|
| Direct | 1 | 1 | 0 |
| Simple loop | 2 | 1 | 1 |
| Fixed graph | 4 | 2 | 2 |
| Critical graph | 7 | 3 | 2 |

Adding nodes beyond the template requires a visible justification and estimated incremental cost.

### 9.1 Fast

For small, low-risk, localised changes.

```text
Task → Cursor Implementer → Deterministic Checks → Terra Verifier when triggered → Human Approval
```

**Examples**

- Copy changes.
- Styling bug.
- Small validation fix.
- Isolated utility function.

### 9.2 Standard

For normal product features and refactors.

```text
Task → Claude Plan → Cursor Implement → Checks → Qwen Review → Terra Verify → Human Approval
```

**Examples**

- New endpoint.
- Dashboard feature.
- Moderate refactor.
- Third-party API integration.

### 9.3 Critical

For high-risk changes.

```text
Task
→ Claude Plan
→ Qwen Plan Critique
→ Claude Plan Revision
→ MiMo Test Design
→ Human Plan Approval (configurable)
→ Cursor Implementation
→ Deterministic Checks
→ Qwen Broad Review
→ Terra Independent Verification
→ Cursor Fix Loop
→ Sol Final Judge
→ Human Merge Approval
```

### 9.4 Custom

The user may create workflows using stage templates:

- Planner.
- Critic.
- Test designer.
- Implementer.
- Deterministic command.
- Reviewer.
- Judge.
- Human approval.
- Notification.
- Export.

A workflow validator must reject:

- two simultaneous writers on one worktree;
- a final judgement before deterministic checks;
- a model reviewing its own implementation without an independent reviewer;
- a merge stage without human approval in MVP;
- loops without a maximum retry count.


---

## 9A. Task Types, Outcome Contracts, and Graph Templates

### 9A.1 Supported task types

```typescript
type TaskType =
  | "new_product"
  | "feature"
  | "bug_fix"
  | "refactor"
  | "test_improvement"
  | "performance"
  | "security_fix"
  | "documentation"
  | "dependency_update"
  | "migration"
  | "investigation"
  | "review_changes";
```


### 9A.1A Task-intent chooser

The first task screen asks a user-facing question rather than exposing graph terminology:

```text
What are you working on?

[Build a New Product]
[Add a Feature]
[Fix a Bug]
[Refactor Code]
[Investigate an Issue]
[Review Existing Changes]
[More task types…]
```

The selected intent determines the initial form, default graph, required evidence, and approval policy. The graph remains inspectable but is not the first concept a new user must understand.

### 9A.1B Optional supporting documents

For `new_product`, `feature`, migration, and other planning-heavy tasks, users may attach:

- product requirements document;
- implementation plan;
- architecture document;
- API specification;
- database schema;
- issue or ticket;
- wireframe;
- screenshot;
- existing code sample;
- research or reference document.

Every attachment has an authority level:

```typescript
type DocumentAuthority =
  | "authoritative_requirement"
  | "approved_plan"
  | "reference"
  | "inspiration_only";
```

Supporting documents are optional. A user can begin from a plain-language brief.

### 9A.1C Document ingestion and conflict resolution

RoleFlock must:

1. store the original file locally and preserve its hash;
2. extract requirements and implementation constraints;
3. retain citations back to the source document;
4. detect conflicting requirements across documents and repository state;
5. ask a typed clarification before implementation when a blocking conflict exists;
6. generate an Outcome Contract from the resolved requirements;
7. require plan approval for a new product or critical feature according to policy.

Example:

```text
Conflict detected

Authoritative PRD:
Authentication uses email magic links.

Implementation plan:
Authentication uses Google OAuth.

[Use magic links]
[Use Google OAuth]
[Support both]
[Edit requirement]
```

The agent may recommend a decision but cannot silently choose between conflicting authoritative inputs.

### 9A.1D New-product graph

A new product must not jump directly from a broad idea to unrestricted coding.

```text
Product Brief and Documents
→ Product Understanding
→ Architecture and Implementation Plan
→ Plan Critic
→ Human Plan Approval
→ Milestone Decomposition
→ Milestone Implementation Graphs
→ Integrated Verification
→ Human Release Decision
```

Each milestone receives its own bounded graph, budget, acceptance criteria, worktree/branch policy, and evidence bundle.

---

### 9A.2 Outcome contract

Every task starts with a machine-readable contract.

```typescript
interface OutcomeContract {
  taskId: string;
  objective: string;
  acceptanceCriteria: AcceptanceCriterion[];
  prohibitedOutcomes: string[];
  requiredEvidence: EvidenceRequirement[];
  riskClass: "low" | "medium" | "high" | "critical";
  outOfScope: string[];
}
```

Each criterion declares how it will be verified:

```typescript
interface AcceptanceCriterion {
  id: string;
  statement: string;
  verificationType:
    | "test"
    | "command"
    | "database_assertion"
    | "browser_assertion"
    | "schema"
    | "model_review"
    | "human";
  verifierRef: string;
  blocking: boolean;
}
```

### 9A.3 Stage contract

Before an implementation sprint begins, implementer and evaluator agree on what “done” means for that stage.

```yaml
stage_contract:
  objective: Prevent concurrent duplicate payment processing

  implementer_proposal:
    files:
      - PaymentWebhookService.ts
      - PaymentEventRepository.ts
      - payment-webhook.test.ts

  evaluator_requirements:
    tests:
      - sequential duplicate delivery
      - concurrent duplicate delivery
      - retry after partial failure
      - invalid signature

  done_when:
    - one provider event creates at most one ledger record
    - database uniqueness protects concurrent requests
    - all existing payment tests pass
```

Contract negotiation is bounded and cannot become an unlimited debate.

### 9A.4 Feature graph

```text
Outcome Contract
→ Architect
→ Plan Critic Loop
→ Test Designer
→ Implementer
→ Deterministic Checks
→ Broad Review
→ Independent Verification
→ Human Approval
```

Required artefacts:

- user problem;
- expected outcome;
- scope and out-of-scope;
- UI/API/data impact;
- acceptance criteria;
- test plan;
- backwards-compatibility review.

### 9A.5 Bug-fix graph

```text
Reproduce
→ Root Cause Investigator
→ Regression Test Must Fail
→ Implement Fix
→ Regression Test Must Pass
→ Existing Tests
→ Regression Reviewer
→ Independent Verifier
→ Approval
```

Blocking invariant:

```text
Before fix: reproduction test = FAIL
After fix: reproduction test = PASS
Existing required tests = PASS
```

### 9A.6 Refactor graph

```text
Capture Baseline Behaviour
→ Refactor Plan
→ Implement
→ Behaviour Comparison
→ Complexity / Performance Check
→ Verify
```

### 9A.7 Security graph

```text
Threat Analysis
→ Containment Plan
→ Implement
→ Security Checks
→ Independent Security Review
→ Final Judge
→ Human Approval
```

### 9A.8 Investigation graph

Read-only by default:

```text
Collect Evidence
→ Parallel Hypotheses
→ Evidence Join
→ Skeptical Reviewer
→ Human Decision
```

An investigation cannot silently become a writing task.

### 9A.9 Migration graph

```text
Architect
→ Migration Risk Review
→ Backup and Rollback Contract
→ Implementer
→ Dry Run
→ Data Assertions
→ Final Judge
→ Human Approval
```

---

## 10. Information Architecture

Primary navigation:

1. **Overview**
2. **Tasks**
3. **Projects**
4. **Roles**
5. **Providers & Quota**
6. **Cost & Usage**
7. **Workflow Templates**
8. **Approvals**
9. **Audit**
10. **Settings**

Global controls:

- New Task.
- Global run-control drawer.
- Pause scheduling.
- Emergency stop.
- Current monthly budget.
- Provider health.
- Local daemon status.
- Notifications.
- Search / command palette.

---

## 11. UI Requirements

## 11.1 Overview Dashboard

### Purpose

Provide an immediate answer to:

- What is running?
- What is blocked?
- How much has been spent?
- Which provider is close to its limit?
- What requires human action?

### Components

**KPI cards**

- Active tasks.
- Awaiting approval.
- Actual API spend today.
- Estimated total task value/cost.
- Monthly budget used.
- Provider health.

**Active pipeline**

Each task shows:

- Project and branch.
- Workflow mode.
- Current node and execution phase.
- Current role, provider, and configured model.
- Permission profile and writer-lock owner.
- Current tool or command.
- Elapsed time and last heartbeat.
- Task budget used.
- Quota warning.
- Inspect, pause, stop node, force terminate, or cancel actions according to policy.
- Pending confirmation or stop acknowledgement.

**Attention panel**

- Confirmation or approval required.
- Grouped identical approvals available.
- Reviewer requested changes.
- Provider quota below threshold.
- API key expiring or invalid.
- Failed deterministic checks.
- Worktree dirty outside RoleFlock.

**Provider quota strip**

Compact cards for Claude, Cursor, Codex, and every configured Custom Provider connection.

---

## 11.2 New Task Screen

### Required fields

- Task intent/type selected from the user-facing chooser.
- Task title.
- Detailed brief.
- Project/repository.
- Base branch.
- Risk level.
- Workflow mode.
- Maximum actual API cost.
- Maximum revision loops.
- Deadline or priority.
- Paths in scope.
- Paths explicitly out of scope.

### Optional fields

- Issue or ticket URL.
- PRD.
- Implementation plan.
- Architecture document.
- API specification.
- Wireframe or screenshot.
- Other reference files.
- Authority level for every supporting document.
- Acceptance criteria supplied by user.
- Required commands.
- Environment profile.
- Memory sources.
- Preferred models.
- Fallback policy.
- Human plan approval requirement.
- Auto-open pull request after approval.


### Requirement and document preview

Before launch, the UI shows:

- extracted objective;
- authoritative requirements;
- approved implementation-plan constraints;
- references and inspiration clearly separated;
- unresolved contradictions;
- proposed acceptance criteria;
- proposed out-of-scope items;
- recommended execution mode;
- whether human plan approval is required.

Implementation cannot start while a blocking authoritative conflict is unresolved.

### Role preview

Before launch, the UI shows:

| Stage | Role | Model | Access | Estimated cost | Quota impact |
|---|---|---|---|---:|---|
| Planning | Architect | Claude Opus 5 High | Read-only | Included / shadow | Medium |
| Plan review | Critic | Custom Provider A / Qwen 3.8 Max Review | Read-only | Estimated API | Low |
| Test design | Test Designer | Custom Provider B / MiMo v2.5 Pro | Read-only | Estimated API | Very low |
| Implementation | Implementer | Cursor Grok 4.5 High | Write | Included / shadow | High |
| Verification | Verifier | GPT-5.6 Terra | Read-only | Included / shadow | Medium |
| Final review | Judge | GPT-5.6 Sol | Read-only | Included / shadow | High |

The launch button must state the expected policy, for example:

> Start Critical Workflow — maximum actual API spend $3.00, two fix loops, human merge approval required.

---

## 11.3 Task Detail Screen

### Header

- Task title and ID.
- Project.
- Base and task branch.
- Workflow.
- Status.
- Risk.
- Owner.
- Actual API cost.
- Shadow cost.
- Budget remaining.
- Started time and elapsed time.
- Active node, role, provider, configured model, permission profile, action, and heartbeat.
- Run-control status: running, pause requested, stopping, awaiting confirmation, or recovering.

### Stage timeline

Each stage card includes:

- Role and model.
- Status.
- Start and end time.
- Input artefacts.
- Output artefacts.
- Token usage.
- Actual and shadow cost.
- Quota before/after, where available.
- Permission profile.
- Retries.
- Logs.
- Approve, reject, retry, switch model, skip, pause, stop, force terminate, or cancel actions based on policy.
- Confirmation requests and any approval grant applied.

### Evidence tabs

- Summary.
- Plan.
- Acceptance criteria.
- Test matrix.
- Diff.
- Test results.
- Reviews.
- Cost.
- Logs.
- Audit events.

### Live log

Events are streamed but secrets are redacted. The user may filter:

- Orchestrator.
- Model output.
- Tool calls.
- Shell commands.
- Git.
- Test runner.
- Usage.
- Security.

### Human confirmations and approvals

The task detail screen embeds the same typed request used by the global Approval Inbox. It must show:

- originating node, role, provider, configured model, and attempt;
- why the request is needed now;
- exact action, command, paths, diff, network destination, or budget change;
- what happens next on approve, reject, or request changes;
- cost already incurred and estimated additional cost;
- quota and risk impact;
- whether similar pending requests exist;
- whether an approval grant can safely be created;
- buttons: Approve once, approve grouped identical requests, create scoped grant, request changes, reject, pause task, cancel task.

---

## 11.4 Roles Screen

Each role card displays:

- Role name.
- Mission.
- Current default model.
- Backup models.
- Permission profile.
- Input schema.
- Output schema.
- Maximum turns.
- Timeout.
- Budget.
- Prompt template version.
- Recent success rate.
- Average cost.
- Average duration.

Role editor supports:

- Change model.
- Add fallback chain.
- Edit instructions.
- Configure allowed tools.
- Configure context selection.
- Configure output schema.
- Configure escalation rules.
- Test role against a sample task.
- Version and rollback role configuration.

---

## 11.5 Providers & Quota Screen

### Provider card

- Provider and connection type.
- Account label.
- Authentication state.
- Last health check.
- Models available.
- Current quota windows.
- Reset time.
- API balance.
- Rate-limit status.
- Billing mode.
- Data confidence.
- Last successful synchronisation.
- Test connection button.
- Refresh button.
- Open provider dashboard button.

### Quota confidence

Every quota value carries a badge:

- **Exact — provider API**
- **Exact — local app server**
- **Metered locally**
- **Estimated**
- **Manual snapshot**
- **Unknown**

### Provider-specific MVP behaviour

#### Claude subscription

- Run-level tokens and estimated session cost captured from Claude Code JSON, status-line data, SDK messages, or OpenTelemetry.
- Five-hour and weekly plan usage shown from an official machine-readable source only when available.
- Otherwise the user can enter a manual snapshot from Claude Settings → Usage.
- RoleFlock must not present its own local run totals as complete account-wide quota if the user also uses Claude outside RoleFlock.

#### Codex subscription

- Use Codex app-server rate-limit data when available.
- Display quota window, used percentage, and reset time.
- Allow `/status`-based user verification.
- Track each RoleFlock run locally.

#### Cursor subscription

- Team or Enterprise: use Cursor Admin API for usage events and spend when configured.
- Individual plan: track RoleFlock-started Cursor invocations locally; allow manual dashboard snapshot for account-wide remaining usage.
- Clearly warn that activity outside RoleFlock may not be included.

#### Custom Providers

Every HTTP model connection is created from the same form and can be edited or replaced without changing the workflow definition.

Required fields:

- Provider display name.
- Connection name.
- Protocol: OpenAI Chat Completions, OpenAI Responses-compatible, Anthropic-compatible, or Custom HTTP adapter.
- Base URL.
- API key stored in the OS keychain.
- One or more model IDs.

Optional fields:

- Custom headers.
- Additional request body fields.
- Model-list endpoint.
- Usage or billing endpoint.
- Quota endpoint.
- Balance endpoint.
- Request timeout and retry policy.
- Input, cached-input, cache-write, output, and per-request pricing.
- Currency and effective date.
- Context-window and output-token limits.
- Capability flags for tools, structured output, vision, and reasoning.

Example connections:

- **Qwen Gateway** → `qwen3.8-max-review`
- **Xiaomi Gateway** → `mimo-v2.5-pro`

These examples can be renamed, replaced, disabled, or assigned to different roles.

For every call RoleFlock:

- records response usage tokens when returned;
- calculates cost using the selected model price card;
- captures rate-limit headers where available;
- calls optional quota or billing endpoints only when configured;
- otherwise reports locally metered usage or a manual snapshot;
- never assumes all providers implement the same billing API.
---

## 11.6 Cost & Usage Screen

### Cost terminology

RoleFlock stores three separate values:

1. **Actual charge**
   - Money expected to be charged by API usage.
   - For subscription-included usage, usually $0 incremental until extra credits or overage apply.

2. **Shadow cost**
   - API-equivalent value of subscription usage, calculated from token counts and a configured public or custom price card.
   - Used to compare efficiency across models.
   - Never presented as an actual bill.

3. **Allocated subscription cost**
   - Optional accounting distribution of monthly subscription fees across tasks.
   - Example methods: per invocation, token-weighted, active-minute weighted, or user-defined.

### Cost views

- Today, week, month, billing cycle.
- By task.
- By project.
- By provider.
- By model.
- By role.
- By workflow stage.
- Actual vs shadow.
- Included vs overage.
- Cached vs uncached input.
- Failed-call cost.
- Revision-loop cost.
- Cost per accepted task.
- Cost per merged change.
- Cost per passing acceptance criterion.

### Budget controls

- Monthly workspace budget.
- Project budget.
- Task budget.
- Role-stage budget.
- Maximum cost per invocation.
- Warning thresholds at 50%, 75%, 90%, and 100%.
- Hard stop or approval gate.
- Fallback to cheaper model.
- Disable optional stages.
- Never skip required critical review due solely to budget; instead pause for approval.


---

## 11A. Graph, Loop, Context, Skills, and Evaluation UI

### 11A.1 Additional primary navigation

Version 2.3 navigation:

1. Overview
2. Tasks
3. Graph Runs
4. Workflow Templates
5. Graph Builder
6. Roles
7. Providers & Quota
8. Cost & Usage
9. Context
10. Skills & Memory
11. Evaluations
12. Audit
13. Settings

The free-form Graph Builder may remain template-based or read-only in MVP. Runtime correctness is more important than a visual editor.

### 11A.2 Graph Run canvas

Display:

- nodes;
- edges;
- branches;
- joins;
- cycles;
- current state;
- write locks;
- human gates;
- provider fallback route.

Each node opens a drawer containing:

- role;
- provider and model;
- permissions;
- compiled context;
- input and output artefacts;
- tool calls;
- duration;
- tokens;
- actual and shadow cost;
- quota before and after;
- attempt number;
- evidence;
- selected outgoing edge;
- active process ID or adapter run identifier where safe to expose;
- heartbeat age and responsiveness;
- pending control command;
- confirmation request status.

The graph canvas header contains persistent controls: `Pause scheduling`, `Stop active node`, `Cancel task`, and `Emergency stop`. Destructive controls require a confirmation dialog that explains repository and process consequences.

### 11A.3 Loop Monitor

```text
Attempt 1
Implementation → concurrency test failed

Attempt 2
Unique constraint added → tests passed → reviewer found missing rollback

Attempt 3
Rollback added → all checks passed
```

Show:

- current and maximum attempts;
- reason for retry;
- new evidence;
- changes since previous attempt;
- cost per attempt;
- cumulative cost;
- remaining budget;
- next escalation.


### 11A.4 Run Control and Approval Inbox

The global Run Control drawer shows every active node in a compact table:

| Task | Node | Role | Provider / model | Phase | Elapsed | Control |
|---|---|---|---|---|---:|---|
| RM-1043 | Plan | Chief Architect | Claude / Opus 5 High | Reading repository | 03:42 | Inspect · Pause · Stop |

The Approval Inbox groups requests by fingerprint while retaining individual task details. The default card shows:

- request type and risk;
- source role/model/node;
- exact requested action;
- number of identical pending requests;
- matching active grant, when any;
- expiry or timeout;
- approve/reject consequences.

Approval controls:

- Approve once.
- Approve all currently grouped identical requests.
- Create task-scoped or exact-fingerprint grant.
- Edit allowed paths, command pattern, risk ceiling, cost ceiling, expiry, and maximum applications.
- Revoke grant.
- Review each request separately.

Sensitive actions are never included in reusable approval grants in MVP.
### 11A.5 Skills and Memory

Sections:

- published skills;
- candidate lessons;
- validating;
- rejected;
- deprecated;
- version history;
- evidence;
- rollback.

### 11A.6 Evaluations

Display:

- datasets;
- experiments;
- model comparisons;
- graph comparisons;
- skill comparisons;
- graders;
- transcripts;
- regression alerts;
- promotion decisions.

### 11A.7 Cost additions

Cost analytics add:

- by graph;
- by node;
- by loop attempt;
- failed-attempt cost;
- parallel-branch cost;
- cost per accepted change.

---

## 12. Quota and Usage Feasibility Matrix

| Provider | Run-level usage | Account-wide remaining quota | Cost source | MVP confidence |
|---|---|---|---|---|
| Claude Code subscription | Tokens and estimated cost can be captured locally | No assumption of public personal quota API; manual or supported local source | Included usage + shadow price | Mixed |
| Codex subscription | Local events and app-server information | App-server rate-limit buckets or verified status | Included usage + optional credits + shadow price | High where app-server available |
| Cursor individual | RoleFlock local invocations | Manual dashboard snapshot unless supported account endpoint exists | Included usage and local shadow estimate | Mixed |
| Cursor Teams/Enterprise | Usage events and spend via Admin API | Team usage/spend API | Official event cost | High |
| Custom Provider connections | Response usage when provided; otherwise local estimates | Optional configured quota/billing endpoint, rate-limit headers, imported snapshot, or manual | Per-model configurable price card or provider event | High for calls made by RoleFlock when usage is returned |

RoleFlock must never fabricate an account-wide percentage. When a provider does not expose it, the UI says:

> Account-wide quota unavailable. RoleFlock has metered 18 calls since the last manual snapshot.

---

## 13. Orchestration State Machine

### Task states

```text
DRAFT
READY
QUEUED
RUNNING
PAUSE_REQUESTED
PAUSING
AWAITING_CONFIRMATION
AWAITING_APPROVAL
CHANGES_REQUIRED
BLOCKED
PAUSED
CANCELLING
CANCELLED
EMERGENCY_STOPPED
FAILED
COMPLETED
ARCHIVED
```

### Stage states

```text
PENDING
WAITING_FOR_DEPENDENCY
READY
RUNNING
WAITING_FOR_CONFIRMATION
AWAITING_APPROVAL
PAUSE_REQUESTED
PAUSING
PAUSED
STOP_REQUESTED
STOPPING
STOPPED
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

### State rules

- A task is `RUNNING` when at least one permitted stage is running.
- A task is `AWAITING_CONFIRMATION` when an agent or node emitted a typed confirmation request.
- A task is `AWAITING_APPROVAL` when workflow policy requires a formal transition approval.
- A stage cannot start until dependencies pass.
- A writing stage acquires an exclusive worktree lock.
- A reviewer cannot pass if required deterministic checks failed.
- A final judge cannot modify source.
- Exceeding maximum fix loops changes the task to `BLOCKED`.
- Exceeding a hard budget pauses the task before the next paid invocation.
- Quota exhaustion triggers fallback evaluation or pause.
- Provider failure does not automatically retry with a more expensive model unless policy allows it.
- A pause or stop request is durable and cannot be cleared by model output.
- `STOPPED` and `INTERRUPTED` nodes require an explicit resume, retry, skip, or cancel decision.
- Emergency stop prevents new runtime leases until the user acknowledges reconciliation results.
- Approval decisions are idempotent; duplicate API calls cannot apply the underlying action twice.


---

## 13A. Durable Graph Runtime

### 13A.1 Separation of concerns

```text
Session
= append-only event history

Harness
= graph and loop runtime

Sandbox
= worktree and command execution

Model context
= temporary compiled projection of state
```

A context window may end without ending the task.

### 13A.2 Event store

Every transition creates an immutable event.

```json
{
  "eventId": "evt_01",
  "taskId": "RM-1043",
  "type": "stage.verification.failed",
  "stageId": "verify-1",
  "attempt": 1,
  "timestamp": "2026-07-26T08:32:10+07:00",
  "payload": {
    "failureClass": "missing_test",
    "nextNode": "implement-fix",
    "findingIds": ["finding-82"]
  }
}
```

### 13A.3 Recovery process

After daemon restart:

1. Read the latest task snapshot.
2. Replay later events through a deterministic reducer.
3. Reconcile subprocess and worktree locks.
4. Mark lost processes as interrupted.
5. Resume from the last confirmed boundary.
6. Do not repeat a paid invocation unless its idempotency policy permits it.
7. Reconnect live UI event streaming.

### 13A.4 Idempotency

Stable invocation key:

```text
task_id + graph_version + node_id + attempt
```

### 13A.5 Initial implementation decision

MVP uses:

- SQLite;
- append-only event table;
- materialised task snapshots;
- explicit TypeScript state reducers;
- process reconciliation on startup.

The graph domain model must remain independent from the runtime. Temporal or another durable-execution platform can be considered later for distributed remote runners and multi-day workflows.

### 13A.6 Graph and node states

Task states:

```text
DRAFT
READY
QUEUED
RUNNING
AWAITING_APPROVAL
CHANGES_REQUIRED
BLOCKED
PAUSED
CANCELLED
FAILED
COMPLETED
ARCHIVED
```

Node states:

```text
PENDING
WAITING_FOR_DEPENDENCY
READY
RUNNING
AWAITING_APPROVAL
INTERRUPTED
RETRYING
PASSED
CHANGES_REQUIRED
SKIPPED
BLOCKED
CANCELLED
FAILED
```

### 13A.7 Long-context handoff

For long-running work:

1. Stop before context quality degrades.
2. Produce a structured handoff.
3. Start a fresh model session.
4. Verify that state can be reconstructed.
5. Preserve blockers, next action, and prohibited actions.

```typescript
interface SessionHandoff {
  objective: string;
  completedWork: string[];
  changedFiles: string[];
  currentEvidence: string[];
  unresolvedIssues: string[];
  nextAction: string;
  prohibitedActions: string[];
  relevantArtefactRefs: string[];
}
```


---

## 13B. Runtime Leases, Process Control, and Recovery

### 13B.1 Runtime leases

Each running node owns a renewable runtime lease. A writer node also owns an exclusive worktree write lease. Leases include owner, process identity, heartbeat, expiry, and recovery policy.

### 13B.2 Adapter cancellation contract

Every provider adapter declares:

```typescript
interface CancellationCapability {
  cooperativeCancel: boolean;
  processSignal: boolean;
  remoteCancel: boolean;
  resumableSession: boolean;
  safeBoundaryPause: boolean;
}
```

The UI shows the truthful capability. `Stop` cannot imply remote cancellation when only a local client process can be terminated.

### 13B.3 Orphan process reconciliation

On startup and after emergency stop, the daemon:

1. finds RoleFlock-owned process records;
2. checks operating-system process identity and start time;
3. reconciles runtime and writer leases;
4. captures worktree status;
5. classifies each node as resumable, interrupted, or unclean;
6. asks for human action when source state is ambiguous.

### 13B.4 Stop timeout

A cooperative stop has a configurable grace period. After expiry the UI offers `Continue waiting` or `Force terminate`. RoleFlock never silently escalates to a hard kill for a writer unless policy explicitly enables it.

### 13B.5 Confirmation invalidation

A pending or approved confirmation is invalidated when any security-relevant field changes, including command, arguments, affected paths, worktree hash, risk, cost ceiling, provider/model capability, or graph version.

---

## 14. System Architecture

```text
┌────────────────────────────────────────────────────────────────┐
│                         RoleFlock UI                            │
│ Overview · Tasks · Roles · Providers · Cost · Audit · Settings│
└───────────────────────────────┬────────────────────────────────┘
                                │ local HTTP/WebSocket
┌───────────────────────────────▼────────────────────────────────┐
│                    Local Control Plane                         │
│ Task Engine · Policy Engine · Scheduler · Cost Ledger          │
│ Quota Engine · Approval Engine · Event Bus · Secrets Broker    │
└──────────────┬────────────────┬────────────────┬───────────────┘
               │                │                │
       ┌───────▼──────┐ ┌──────▼───────┐ ┌─────▼──────────────┐
       │ CLI Adapters │ │ API Adapters │ │ Repository Runtime │
       │ Claude       │ │ Custom APIs  │ │ Git worktrees      │
       │ Cursor       │ │ Model gateways│ │ command sandbox    │
       │ Codex        │ │ custom OAI   │ │ diff/test capture  │
       └───────┬──────┘ └──────┬───────┘ └─────┬──────────────┘
               │               │               │
       local subscriptions   HTTPS APIs      local repositories
```

### 14.1 Recommended deployment

**MVP:** Local daemon plus web UI at `http://127.0.0.1:4178`. The public website remains `https://roleflock.com` and does not execute local agents.

Reasons:

- Personal subscription CLIs authenticate on the user’s machine.
- Source code and worktrees are local.
- OS keychain can protect secrets.
- The orchestrator can safely run repository commands.
- It avoids uploading subscription credentials to a hosted server.

**Future:** Optional cloud coordination service containing encrypted metadata, templates, and team policies while execution remains on registered local runners.

---

## 15. Core Components

### 15.1 UI application

Recommended stack:

- Next.js or Vite + React.
- TypeScript.
- Tailwind CSS.
- TanStack Query.
- WebSocket or Server-Sent Events for live updates.
- Monaco or CodeMirror for diff and prompt views.

### 15.2 Local daemon

Recommended stack:

- Node.js 24+ with TypeScript.
- Fastify or Hono HTTP server.
- `execa` or native child process management.
- SQLite with Drizzle or Prisma.
- OS keychain via Keytar or native secure storage.
- Zod for internal validation.
- JSON Schema for model outputs.


### 15.3 Run Control Manager

- Maintains `ActiveExecution` snapshots.
- Owns runtime leases and heartbeats.
- Processes pause, stop, force-terminate, cancel, and emergency-stop commands.
- Reconciles child processes and worktrees after interruption.
- Emits truthful control acknowledgements and completion events.

### 15.4 Confirmation and Approval Manager

- Validates typed confirmation requests.
- Computes security-relevant fingerprints.
- Groups identical pending requests.
- Matches scoped approval grants.
- Enforces non-reusable sensitive-action categories.
- Applies decisions idempotently.
- Invalidates approvals after material state changes.

### 15.5 Scheduler

Responsibilities:

- Resolve ready stages.
- Enforce dependency and budget rules.
- Acquire provider and worktree locks.
- Apply concurrency limits.
- Retry transient failures.
- Emit events.
- Persist checkpoints.

### 15.6 Repository runtime

Responsibilities:

- Validate clean base repository.
- Create task branch and worktree.
- Lock worktree to one writer.
- Capture pre/post Git state.
- Record files changed.
- Run allowlisted commands.
- Enforce timeouts and output limits.
- Generate patches and diff summaries.
- Clean up or archive worktrees.

### 15.7 Provider adapters

Uniform interface:

```ts
interface ProviderAdapter {
  id: string;
  connectionType: "cli" | "app-server" | "openai-compatible" | "custom-api";

  healthCheck(): Promise<ProviderHealth>;
  listModels(): Promise<ModelDescriptor[]>;
  invoke(request: ModelInvocationRequest): AsyncIterable<InvocationEvent>;
  cancel(invocationId: string): Promise<void>;

  getUsageSnapshot?(): Promise<UsageSnapshot>;
  getQuotaSnapshot?(): Promise<QuotaSnapshot>;
}
```

### 15.8 Usage and cost ledger

Every invocation writes immutable ledger entries:

- Provider.
- Model.
- Role.
- Project.
- Task.
- Stage.
- Request ID.
- Started and ended timestamps.
- Input tokens.
- Cached input tokens.
- Cache writes.
- Output tokens.
- Tool calls.
- Actual cost.
- Shadow cost.
- Currency.
- Price-card version.
- Usage confidence.
- Quota before and after.
- Failure category.

---


## 16. Provider Integration Requirements

Every adapter must implement or explicitly mark unsupported:

- health check;
- configured model identity;
- streaming activity events;
- heartbeat;
- cooperative cancel;
- forced local process termination;
- remote cancellation when supported;
- session resume when supported;
- token and cost usage;
- structured confirmation request extraction;
- final process exit classification.

The UI must not advertise pause, remote cancellation, or resumability when the adapter cannot provide it.


### 16.0 Provider strategy and capability routing

RoleFlock remains provider-agnostic and supports both one-provider and cross-provider workflows.

Default strategy:

```text
Subscription-first
Capability-driven
Provider-agnostic
Smallest sufficient graph
Custom API only when it adds measurable value
```

The graph requests capabilities, not brand names:

```typescript
interface NodeCapabilityRequirements {
  toolUse?: boolean;
  repositoryRead?: boolean;
  workspaceWrite?: boolean;
  structuredStreaming?: boolean;
  nativeApproval?: boolean;
  interrupt?: boolean;
  sessionResume?: boolean;
  modelDiscovery?: boolean;
  usageReporting?: boolean;
  quotaReporting?: boolean;
  vision?: boolean;
  localOnly?: boolean;
}
```

A role may have a default adapter, but the runtime may use another compatible mapping when allowed by policy and approved fallback rules.

Recommended defaults:

```text
Architect           → Claude Code, strongest suitable configured model
Primary Implementer → Cursor CLI by default; Claude Code or Codex permitted
Verifier            → Codex App Server by default; independent compatible model permitted
Bounded specialist  → Custom Provider or local model
```

A fallback must never silently reduce required permissions, verification strength, privacy policy, or tool capability.

### 16.0A Adapter architecture

```text
Claude Code adapter
→ programmatic/headless CLI or supported agent interface
→ structured events where available
→ RoleFlock permission bridge
→ process-level stop and provider-native controls when available

Codex adapter
→ prefer Codex App Server for rich client integration
→ authentication, model discovery, streamed events,
  approvals, user-input requests, interruption, and usage where exposed

Cursor adapter
→ user-installed Cursor CLI
→ isolated task worktree and external sandbox enforcement
→ structured output where available
→ truthful disclosure when approval or remote interruption is not native

Custom Provider adapter
→ OpenAI-compatible, Anthropic-compatible, custom HTTP, or localhost model endpoint
```

Adapter capabilities must be detected and stored. The UI must not claim native pause, approval, resume, quota, or cancellation when the adapter only provides local process termination or locally estimated usage.

### 16.0B Cursor safety rule

Cursor remains the default writer example, not a hard-coded requirement. Because a non-interactive CLI may have broader workspace access than a structured approval protocol, RoleFlock must rely on:

- isolated Git worktree;
- one-writer lease;
- filesystem and secret denylist;
- typed preflight permission envelope;
- constrained command policy;
- process tree monitoring;
- worktree reconciliation after interruption.

Parsing terminal confirmation text through a PTY may be supported as a fallback, but must not be the sole security boundary.

---

## 16.1 Claude adapter

Connection:

- Detect installed Claude Code.
- Verify authenticated account.
- Support non-interactive runs.
- Use plan/read-only permission profile for architect role.
- Stream JSON events when supported.
- Capture session ID, usage, duration, lines changed, and estimated cost.
- Support OpenTelemetry export to RoleFlock collector.

Restrictions:

- Do not pass subscription credentials to RoleFlock UI.
- Do not assume estimated API cost equals subscription charge.
- Do not invoke write tools for the architect role.

## 16.2 Cursor adapter

Connection:

- Detect Cursor Agent CLI.
- Verify login.
- Select configured model alias.
- Stream structured output.
- Execute only inside task worktree.
- Use Cursor permission configuration.
- Capture invocation duration, output, commands, and local token data where exposed.

Team integration:

- Optional Cursor Admin API key.
- Import usage events and spending.
- Map Cursor event to RoleFlock task when correlation metadata is available.
- Otherwise display account spend separately from task-attributed spend.

## 16.3 Codex adapter

Connection:

- Support `codex exec` for non-interactive stages.
- Prefer app-server for richer structured control and rate-limit data.
- Capture usage events and quota buckets.
- Use read-only sandbox for verifier and judge.
- Allow safe tests only when policy grants them.
- Support structured output schema.

## 16.4 Custom Provider adapter

Custom Providers are user-created connections. Qwen and Xiaomi MiMo use this same adapter and receive no hard-coded privileges.

### Connection schema

```ts
type CustomProviderConnection = {
  id: string;
  providerName: string;
  connectionName: string;
  protocol:
    | "openai-chat-completions"
    | "openai-responses"
    | "anthropic-messages"
    | "custom-http";
  baseUrl: string;
  apiKeySecretId: string;
  defaultHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  modelListEndpoint?: string;
  usageEndpoint?: string;
  quotaEndpoint?: string;
  balanceEndpoint?: string;
  models: CustomModelConfig[];
};

type CustomModelConfig = {
  id: string;
  displayName?: string;
  enabled: boolean;
  capabilities: {
    tools?: boolean;
    structuredOutput?: boolean;
    vision?: boolean;
    reasoning?: boolean;
  };
  contextWindow?: number;
  maxOutputTokens?: number;
  priceCardId?: string;
};
```

### UI fields

- Provider name, for example `Alibaba Cloud`, `Xiaomi`, `OpenRouter`, or `Internal Gateway`.
- Connection name, for example `Qwen Production` or `Cheap Test Models`.
- Protocol.
- Base URL.
- API key.
- Model IDs.
- Optional headers and request body.
- Optional pricing.
- Optional quota, balance, usage, or model-list endpoints.
- Test connection and test model buttons.

### Runtime requirements

- Support multiple connections from the same provider.
- Support multiple models per connection.
- Allow a role to switch model without changing workflow stages.
- Preserve the exact provider, connection, model, and price-card version on every invocation.
- Validate endpoint compatibility before assigning a model to a role.
- Redact API keys and sensitive header values.
- Parse standard token usage when available.
- Allow a provider-specific parser plugin for non-standard responses.
- Capture rate-limit headers without assuming their names.
- Support connection-level and model-level concurrency limits.

### Example: Qwen

```yaml
custom_providers:
  - provider_name: Alibaba Cloud
    connection_name: Qwen Gateway
    protocol: openai-chat-completions
    base_url_env: QWEN_BASE_URL
    api_key_secret: qwen_gateway_key
    models:
      - id: qwen3.8-max-review
        display_name: Qwen 3.8 Max Review
```

### Example: Xiaomi MiMo

```yaml
custom_providers:
  - provider_name: Xiaomi
    connection_name: MiMo Gateway
    protocol: openai-chat-completions
    base_url_env: XIAOMI_BASE_URL
    api_key_secret: xiaomi_gateway_key
    models:
      - id: mimo-v2.5-pro
        display_name: MiMo v2.5 Pro
```

Both examples are ordinary editable records and can be deleted or replaced.
---

## 17. Cost Engine

### 17.1 Price card

```ts
type PriceCard = {
  providerId: string;
  modelId: string;
  currency: "USD" | "CNY" | string;
  effectiveFrom: string;
  inputPerMillion?: number;
  cachedInputPerMillion?: number;
  cacheWritePerMillion?: number;
  outputPerMillion?: number;
  perRequest?: number;
  subscriptionMonthly?: number;
  source: "official" | "provider-event" | "custom" | "unknown";
};
```

### 17.2 API cost formula

```text
actual_cost =
  uncached_input_tokens × input_rate
+ cached_input_tokens × cached_input_rate
+ cache_write_tokens × cache_write_rate
+ output_tokens × output_rate
+ per_request_fee
```

All token rates are normalised per one million tokens.

### 17.3 Subscription usage

For subscription services:

```text
actual incremental charge = provider-reported overage or credits used
shadow cost = token usage × configured API-equivalent price
allocated subscription cost = optional accounting method
```

The UI must display these separately. It must not add shadow cost to actual API cost when showing “Amount expected to be billed”.

### 17.4 Task total

```text
task_actual_cost = sum(actual invocation charges)
task_shadow_cost = sum(shadow costs)
task_allocated_subscription_cost = optional allocation
```

### 17.5 Example initial price metadata

These are configuration defaults, not hard-coded permanent truth:

- Every Custom Provider model has an editable, versioned price card. Qwen and MiMo examples start with no trusted rate until the user imports or enters one.
- OpenAI GPT-5.6 Terra and Sol may use optional shadow prices for subscription accounting.
- Provider currency is preserved; workspace reporting may display normalised totals separately.
- Cursor and Claude subscription tasks: actual incremental cost defaults to zero unless provider reports overage or credits; shadow cost remains optional.

---

## 18. Quota Engine

### 18.1 Quota model

```ts
type QuotaBucket = {
  providerId: string;
  accountId: string;
  limitId: string;
  label: string;
  unit: "percent" | "tokens" | "credits" | "requests" | "currency";
  used?: number;
  limit?: number;
  usedPercent?: number;
  remaining?: number;
  windowStart?: string;
  resetsAt?: string;
  confidence: "exact" | "metered_local" | "estimated" | "manual" | "unknown";
  source: string;
  capturedAt: string;
};
```

### 18.2 Routing rules

Examples:

```yaml
routing:
  - when: provider.claude.weekly_remaining_percent < 15
    action: require_approval_before_claude
  - when: provider.cursor.remaining_percent < 10
    action: pause_writer_stage
  - when: task.actual_cost_percent >= 75
    action: warn
  - when: task.actual_cost_percent >= 100
    action: hard_stop
  - when: qwen.health != healthy
    action: use_fallback
    fallback: terra
```

### 18.3 External usage caveat

If the user uses the same subscription outside RoleFlock, local metering is incomplete. The quota screen must say so and show the timestamp of the last account-wide snapshot.

---

## 19. Context and Handoff Design

Each stage receives only the context required for its role.

### 19.1 Shared task bundle

```text
.roleflock/tasks/<task-id>/
├── task.json
├── brief.md
├── repository-map.json
├── plan.md
├── plan-review.json
├── acceptance-criteria.json
├── test-matrix.json
├── implementation-report.json
├── test-report.json
├── reviews/
│   ├── qwen.json
│   ├── terra.json
│   └── sol.json
├── cost-ledger.jsonl
└── audit.jsonl
```

### 19.2 Context policy

- Planner receives high-level repository context and relevant architecture.
- Critic receives task, plan, repository map, and selected evidence.
- Test designer receives acceptance criteria and relevant interfaces, not the whole repository by default.
- Implementer receives approved plan, tests, and permitted repository access.
- Reviewer receives plan, criteria, diff, tests, and relevant source.
- Judge receives condensed evidence plus access to inspect source.

### 19.3 Output schemas

All non-conversational stage outputs use JSON Schema. Free-form Markdown may accompany structured output but cannot replace required fields.


---


### 19.5 Data disclosure manifest

Every cloud invocation produces a local manifest:

```typescript
interface DataDisclosureManifest {
  invocationId: string;
  providerConnectionId: string;
  configuredModelId: string;
  purpose: string;
  selectedFilePaths: string[];
  selectedSummaryRefs: string[];
  excludedSensitivePatterns: string[];
  estimatedInputTokens?: number;
  projectGrantId?: string;
  createdAt: string;
}
```

The manifest records what RoleFlock selected for transmission; it must not duplicate sensitive source contents unnecessarily. It is inspectable from the active-node drawer and audit history.

---

## 19A. Context Compiler, Evaluation, and Internal Learning

### 19A.1 Context Compiler

```text
Stable Role Contract
+ Task Objective
+ Current Graph State
+ Stage Contract
+ Relevant Repository Files
+ Selected Knowledge
+ Previous-attempt Evidence
+ Model-specific Profile
= Invocation Context
```

RoleFlock does not send the same giant prompt to every model.

### 19A.2 Progressive disclosure

A node begins with minimum context and retrieves additional files or knowledge only when needed.

Avoid:

- entire repository dumps;
- every old transcript;
- all project knowledge;
- duplicate instructions;
- irrelevant reviewer reports.

### 19A.3 Model-specific context profiles

```text
Claude profile:
- concise role contract
- judgement-first
- progressive access

Custom reasoning profile:
- explicit schema
- bounded task
- optional examples

Low-cost model profile:
- selected inputs only
- highly structured output
- no broad tool access
```

Profiles are evaluated rather than assumed permanently correct.

### 19A.4 Context Inspector UI

Show:

- token count by source;
- duplicated instructions;
- conflicts;
- selected knowledge;
- source files;
- omitted context;
- previous-attempt evidence;
- handoff summary;
- estimated context cost.

### 19A.5 Evaluation engine

Evals are core infrastructure.

Sources:

- real task failures;
- reverted changes;
- human corrections;
- missed findings;
- false blocks;
- provider regressions;
- historical accepted tasks;
- synthetic adversarial cases.

Graders combine:

- deterministic tests;
- rule checks;
- schema checks;
- repository assertions;
- model judges;
- pairwise comparison;
- human judgement.

### 19A.6 Replay comparisons

RoleFlock can compare:

```text
Model A vs Model B
Prompt v4 vs v5
Skill v2 vs v3
Context strategy A vs B
Graph v6 vs v7
Verifier rubric v2 vs v3
```

Metrics:

- task success;
- criterion success;
- false pass;
- false block;
- actual cost;
- shadow cost;
- latency;
- attempts;
- escalation rate;
- human intervention;
- security harm rate.

### 19A.7 Internal knowledge without MemoSprout

RoleFlock operates independently with a modular local store.

Knowledge types:

```text
architecture_decision
coding_convention
past_failure
review_rule
test_pattern
security_rule
domain_knowledge
rejected_approach
```

### 19A.8 Experience distillation

```text
Completed Task
→ Candidate Lesson
→ Evidence Check
→ Deduplication
→ Conflict Check
→ Replay Evaluation
→ Approval
→ Published Skill
```

A model can propose a lesson but cannot mutate production role prompts directly.

```typescript
interface Skill {
  id: string;
  version: number;
  status: "candidate" | "validated" | "published" | "deprecated" | "archived";
  appliesWhen: SkillTrigger;
  instructions: string[];
  checks: string[];
  evidenceTaskIds: string[];
  evaluationSummary?: EvaluationSummary;
}
```

### 19A.9 Modular external knowledge

```typescript
interface KnowledgeStore {
  search(query: KnowledgeQuery): Promise<KnowledgeItem[]>;
  saveCandidate(candidate: KnowledgeCandidate): Promise<void>;
  publish(candidateId: string): Promise<void>;
  reportOutcome(outcome: KnowledgeOutcome): Promise<void>;
}
```

Initial implementation:

```text
LocalRoleFlockKnowledgeStore
```

Future adapters:

```text
MemoSproutKnowledgeStore
MarkdownKnowledgeStore
MCPKnowledgeStore
```


### 19A.9A Knowledge relationships and future knowledge graph

The execution graph and knowledge graph are distinct:

```text
Execution graph
= who performs work, routing, loops, controls, and approvals

Knowledge relationships
= what the system knows, where it came from, and how facts relate
```

MVP does not require Neo4j or another graph database. Start with SQLite entities and typed relations:

```typescript
interface KnowledgeRelation {
  sourceId: string;
  relationType:
    | "affects"
    | "caused_by"
    | "fixed_by"
    | "verified_by"
    | "depends_on"
    | "supersedes"
    | "applies_to";
  targetId: string;
  evidenceIds: string[];
}
```

Roadmap:

```text
Phase 0–2 → execution graph and immutable evidence
Phase 3   → local knowledge items and full-text retrieval
Phase 4   → typed relationships, provenance, conflict and staleness linting
Phase 5   → optional graph database, cross-project compilation,
            or MemoSprout KnowledgeStore integration
```

Knowledge extraction may use a low-cost model for high-volume structured extraction, a stronger model for difficult entity resolution, and deterministic validation for schema and provenance. Model choices must be evaluated rather than assumed.

---

### 19A.10 Adaptive routing

MVP routing is rule-based using:

- task type;
- risk;
- role;
- capability;
- provider health;
- cost;
- quota;
- latency;
- privacy;
- context size;
- historical evaluation score.

Later versions may recommend routing from evidence, but deterministic policy retains authority.

---

## 20. Permissions and Security

### 20.1 Secret handling

- Secrets stored in OS keychain.
- UI receives masked identifiers only.
- API keys never written to task artefacts.
- Child processes receive minimum required environment variables.
- Logs redact known secrets and common credential patterns.
- `.env*`, private keys, cloud credentials, and password stores are denied by default.

### 20.2 Command policy

Command classes:

- **Safe read:** `git status`, `git diff`, file inspection.
- **Safe test:** configured lint/test/build commands.
- **Package mutation:** requires policy or approval.
- **Database mutation:** denied unless isolated environment and explicit approval.
- **Network mutation:** denied by default.
- **Destructive:** denied.
- **Deploy/push/merge:** human approval required; merge remains out of scope in MVP.

### 20.3 Worktree isolation

- One worktree per task.
- Exclusive writer lock.
- Base branch never edited.
- Dirty state checked before and after stage.
- Unexpected external changes pause the task.
- Optional container sandbox for untrusted commands.

### 20.4 Prompt injection defence

- Treat repository content as untrusted data.
- System instructions define role boundaries.
- Tool permissions are enforced outside the model.
- External documents cannot grant additional permissions.
- Review outputs cannot directly trigger shell commands.
- Provider responses are validated before state transitions.


### 20.5 Confirmation and grant safety

- Approval is not equivalent to expanding the node's permission profile.
- The requested action must already be representable by an allowed typed action or explicit policy exception.
- Approval grants are stored separately from task prompts and model context.
- Agents cannot inspect secret grant tokens or modify grant status.
- Grants are evaluated by deterministic policy code.
- Every auto-applied grant remains visible and revocable.
- Sensitive categories listed in section 4B.11 cannot use reusable grants in MVP.

### 20.6 Data retention

Configurable retention:

- Prompts and responses.
- Model reasoning summaries, where returned.
- Logs.
- Diffs.
- Cost ledger.
- Audit events.
- Export and secure deletion.

---

## 21. Data Model

Core entities:

```text
Workspace
Project
Repository
Task
OutcomeContract
WorkflowGraph
GraphVersion
GraphRun
WorkflowNode
WorkflowEdge
NodeRun
LoopPolicy
LoopAttempt
Role
Model
Provider
ProviderAccount
ProviderConnection
PermissionProfile
Sandbox
Worktree
Session
Event
Invocation
UsageLedgerEntry
QuotaSnapshot
PriceCard
BudgetPolicy
ConfirmationRequest
Approval
ApprovalGroup
ApprovalGrant
ApprovalPolicy
ControlCommand
ActiveExecution
RuntimeLease
ProcessHandle
ExecutionSnapshot
Artefact
TestRun
ReviewFinding
AuditEvent
KnowledgeItem
LessonCandidate
Skill
EvaluationDataset
EvaluationRun
Metric
Notification
```

### 21.1 Key relationships

- Workspace has many projects, providers, roles, and workflows.
- Project has one or more repositories.
- Task belongs to a project and starts one workflow run.
- Workflow run has ordered stage runs.
- Stage run uses one role and one selected model.
- Invocation belongs to a stage run.
- Usage entries belong to invocation, task, project, provider, model, and role.
- ConfirmationRequest blocks a node at a safe boundary until resolved or matched by a valid grant.
- ApprovalGroup contains requests with the same validated fingerprint.
- ApprovalGrant can apply to future compatible requests within explicit scope, expiry, risk, and application limits.
- ControlCommand records pause, stop, termination, cancellation, and emergency-stop lifecycle.
- ActiveExecution is the current truthful UI snapshot for a running node.
- RuntimeLease and ProcessHandle support heartbeat, cancellation, and recovery.
- Approval can gate a stage transition.
- Worktree is locked to one active writer stage.

---

## 22. Local API Surface

Representative endpoints:

```text
GET    /api/health
GET    /api/dashboard

GET    /api/projects
POST   /api/projects
POST   /api/projects/:id/validate

GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/:id
POST   /api/tasks/:id/start
POST   /api/tasks/:id/pause
POST   /api/tasks/:id/resume
POST   /api/tasks/:id/cancel
POST   /api/tasks/:id/retry
GET    /api/control/active
POST   /api/control/emergency-stop
POST   /api/control/emergency-stop/acknowledge

GET    /api/tasks/:id/events
GET    /api/tasks/:id/artefacts
GET    /api/tasks/:id/diff
GET    /api/tasks/:id/cost

POST   /api/stages/:id/approve
POST   /api/stages/:id/request-changes
POST   /api/stages/:id/switch-model
POST   /api/stages/:id/skip
POST   /api/nodes/:id/pause
POST   /api/nodes/:id/stop
POST   /api/nodes/:id/force-terminate
GET    /api/approvals
GET    /api/approvals/groups
POST   /api/approvals/:id/approve
POST   /api/approvals/:id/reject
POST   /api/approvals/:id/request-changes
POST   /api/approvals/groups/:id/approve
GET    /api/approval-grants
POST   /api/approval-grants
POST   /api/approval-grants/:id/revoke

GET    /api/roles
PUT    /api/roles/:id

GET    /api/providers
POST   /api/providers
POST   /api/providers/:id/test
POST   /api/providers/:id/refresh-usage
GET    /api/providers/:id/quota
GET    /api/providers/:id/models

GET    /api/cost/summary
GET    /api/cost/ledger
GET    /api/quota/summary

GET    /api/workflows
POST   /api/workflows
PUT    /api/workflows/:id

GET    /api/audit
```

Live events:

```text
task.created
task.started
task.pause.requested
task.paused
task.cancelling
task.cancelled
workspace.emergency_stop.requested
workspace.emergency_stopped
task.completed
stage.ready
stage.started
stage.phase.changed
stage.heartbeat
stage.pause.requested
stage.stop.requested
stage.stopping
stage.stopped
stage.interrupted
stage.output.delta
stage.tool.started
stage.tool.completed
stage.usage.updated
confirmation.requested
confirmation.grouped
approval.approved
approval.rejected
approval.auto_applied
approval.grant.created
approval.grant.revoked
stage.awaiting_approval
stage.resumed
stage.passed
stage.failed
provider.health.changed
provider.quota.changed
budget.warning
budget.exceeded
worktree.changed
```


### 22A. Graph Runtime API additions

```text
GET    /api/graphs
POST   /api/graphs
GET    /api/graphs/:id
POST   /api/graphs/:id/validate
POST   /api/graphs/:id/clone
POST   /api/graphs/:id/publish

GET    /api/runs/:id
GET    /api/runs/:id/events
GET    /api/runs/:id/state
POST   /api/runs/:id/recover

POST   /api/nodes/:id/retry
POST   /api/nodes/:id/pause
POST   /api/nodes/:id/stop
POST   /api/nodes/:id/force-terminate
POST   /api/nodes/:id/cancel
POST   /api/nodes/:id/switch-model
POST   /api/nodes/:id/skip

GET    /api/context/:nodeRunId
POST   /api/context/:nodeRunId/recompile

GET    /api/skills
POST   /api/skills/:id/validate
POST   /api/skills/:id/publish
POST   /api/skills/:id/rollback

GET    /api/evals
POST   /api/evals
GET    /api/evals/:id
```

Live events:

```text
graph.started
graph.completed
graph.failed
node.ready
node.started
node.phase.changed
node.heartbeat
node.pause.requested
node.stop.requested
node.stopping
node.stopped
node.output.delta
node.tool.started
node.tool.completed
node.usage.updated
node.interrupted
node.awaiting_approval
node.passed
node.failed
loop.attempt.started
loop.attempt.completed
loop.exhausted
edge.selected
confirmation.requested
approval.requested
approval.grouped
approval.auto_applied
approval.grant.created
approval.grant.revoked
control.command.requested
control.command.acknowledged
control.command.completed
```

---

## 23. Notifications

MVP:

- In-app notifications.
- Native desktop notification.
- Optional webhook.

Triggers:

- Approval required.
- Task blocked.
- Test failed.
- Reviewer requested changes.
- Budget threshold crossed.
- Quota below threshold.
- Provider unavailable.
- Task completed.
- Stop request exceeded grace period.
- Node heartbeat became stale.
- Emergency stop requires reconciliation acknowledgement.

Future:

- Email.
- Slack.
- Telegram.
- GitHub comments.
- MemoSprout event capture.

---

## 24. Audit and Reproducibility

Every state-changing action records:

- Actor: user, orchestrator, or role/model.
- Timestamp.
- Previous and new state.
- Policy evaluation.
- Input artefact hashes.
- Output artefact hashes.
- Prompt template version.
- Model ID.
- Provider request ID when available.
- Price-card version.
- Permission profile.
- Command and exit status.
- Approval reason.
- Fallback reason.

Task export produces a ZIP containing all non-secret artefacts and a manifest with hashes.

---

## 25. Failure and Fallback Behaviour

### Provider failure classes

- Authentication failure.
- Quota exhausted.
- Rate limited.
- Model unavailable.
- Transient network failure.
- Invalid output.
- Tool failure.
- Timeout.
- Policy violation.
- Budget exceeded.
- User cancellation.


### Interruption policy

- A user stop request takes precedence over model retry and fallback policy.
- No fallback invocation starts while a task is pausing, stopping, cancelling, or awaiting confirmation.
- A provider timeout is not automatically treated as safe cancellation; RoleFlock reconciles local process, remote request status when available, usage, and worktree state.
- Interrupted writer nodes require a diff and lock inspection before retry.

### Retry policy

- Exponential backoff for transient network and rate-limit errors.
- No blind retry for authentication or budget errors.
- Invalid structured output may receive one schema-repair attempt.
- Maximum retries are stage-configurable.
- Retrying records additional cost.

### Fallback policy

A fallback must define:

- Allowed substitute model.
- Whether role prompt changes.
- Maximum cost.
- Quality warning.
- Whether human approval is required.
- Whether the fallback has adequate permissions.

RoleFlock never silently replaces a final critical judge with a low-cost model.

---

## 26. Non-functional Requirements

### Performance

- Dashboard first paint under two seconds on local machine.
- Event update latency under one second.
- Task creation under one second excluding repository validation.
- Support 20 queued tasks and at least 4 simultaneous read-only stages.
- One writer per worktree.

### Reliability

- Durable task state after daemon restart.
- Idempotent stage transitions.
- Invocation cancellation where provider supports it.
- Automatic recovery of orphaned process records.
- Database backup and export.

### Accessibility

- WCAG 2.1 AA target.
- Keyboard navigation.
- Colour is not the only status indicator.
- Accessible diff and log controls.
- Reduced-motion support.

### Privacy

- Local-first default.
- No telemetry enabled without consent.
- Configurable provider-context policy.
- Export and deletion controls.

---

## 27. MVP User Stories and Acceptance Criteria

### US-01 Connect providers

**As a user,** I can connect Claude, Cursor, Codex, and any number of Custom Providers so that RoleFlock can invoke their configured models.

**Acceptance criteria**

- CLI presence and authentication can be tested.
- API base URL and key can be validated without persisting raw keys outside secure storage.
- Available models can be entered or discovered.
- Connection failures provide actionable diagnostics.
- Provider card shows last health check.

### US-02 Create a role-based task

- User can select project, workflow, risk, budget, and branch.
- UI previews all stages and models.
- Task remains draft until validation passes.
- Invalid writer conflicts are rejected.

### US-03 Monitor execution

- Stage transitions update live.
- User can view model, role, elapsed time, tokens, cost, and log.
- User can pause or cancel.
- Restarting daemon does not lose state.

### US-04 Review implementation

- Diff and tests are available before approval.
- Reviewer findings link to files or acceptance criteria.
- Failed required tests prevent PASS.
- Requesting changes creates a bounded fix loop.

### US-05 Track cost

- API usage is attributed to a task.
- Actual and shadow cost are visually separate.
- Total task actual cost equals ledger sum.
- Price-card version is retained.
- Budget policy can stop the next invocation.

### US-06 Track quota

- Each provider quota shows source and confidence.
- RoleFlock never labels local-only usage as account-wide.
- Reset time is shown when known.
- Manual snapshots include timestamp.
- Low quota can trigger warning or routing policy.

### US-07 Enforce permissions

- Planner cannot edit source.
- Reviewer cannot edit source.
- Only active writer can modify task worktree.
- Denied commands are blocked outside model control.
- Secrets are redacted in logs.

### US-08 Human approval

- Critical workflow can require plan approval and always requires merge approval.
- Approval shows evidence and remaining budget.
- User can record a reason.
- Approval event is audited.

---

## 28. Delivery Plan

### Phase 0 — Technical spikes

- Validate CLI non-interactive execution.
- Validate structured event capture.
- Validate Codex app-server quota data.
- Validate Git worktree isolation.
- Validate at least two Custom Provider connections using the Qwen and MiMo example endpoints.
- Validate token usage parsing.
- Confirm available account-wide quota sources for the user’s exact plans.
- Validate cooperative cancellation, process signals, forced termination, and orphan-process reconciliation for every CLI adapter.
- Validate typed confirmation request extraction and idempotent approval application.
- Validate grouped identical approvals and grant invalidation after material state changes.

### Phase 1 — Local MVP

- Provider connections.
- Project registration.
- Fast and Standard workflows.
- Task list and detail.
- Claude planner.
- Cursor implementer.
- Terra verifier.
- Custom Provider stages, initially configured with Qwen and MiMo examples.
- Deterministic command runner.
- Worktree manager.
- Cost ledger.
- Manual and locally metered quota.
- Human approval.
- Run Control drawer, active execution heartbeat, pause, stop, cancel, and emergency stop.
- Approval Inbox with grouping and scoped grants.

### Phase 2 — Full critical workflow

- Configurable custom-model plan critic.
- Configurable custom-model test designer.
- Sol final judge.
- Fix loop.
- Workflow builder.
- Advanced budget policy.
- Codex app-server quota integration.
- Cursor Admin API integration where eligible.
- OpenTelemetry ingestion for Claude.

### Phase 3 — Team and intelligence layer

- Shared policies and templates.
- Remote local runners.
- Team RBAC.
- GitHub pull request integration.
- Evaluation history and model performance scoring.
- Automatic model routing by quality, cost, speed, privacy, and quota.
- Notifications and scheduled workflows.

---


## 29. Recommended MVP Build Order

1. Define schemas for task, graph, node, event, active execution, confirmation, approval, and control commands.
2. Create local daemon, SQLite event store, reducer, and local UI authentication.
3. Implement Run Control Manager, runtime leases, heartbeats, and process reconciliation.
4. Build project and Git worktree manager with one-writer locking.
5. Implement generic invocation event and cancellation contracts.
6. Implement one CLI adapter end-to-end, including stop and recovery.
7. Implement Custom Provider and remaining CLI adapters.
8. Build task detail UI with truthful active role/provider/model/phase status.
9. Implement deterministic command runner and evidence capture.
10. Implement typed confirmation requests and Approval Inbox.
11. Implement approval grouping, scoped grants, expiry, revocation, and invalidation.
12. Implement smallest-sufficient-graph gate, Fast and Standard templates.
13. Implement bounded verification and fix loop.
14. Implement cost ledger, price cards, quota snapshots, and confidence labels.
15. Implement critical workflow and independent verification.
16. Add dashboard, analytics, export, audit, and security hardening.

The product must not postpone stop/cancel or approval semantics until after agent execution works. They are part of the runtime contract from the first adapter.
---

## 30. Initial Configuration Example

```yaml
workspace:
  currency: USD
  monthly_actual_budget: 50
  local_only: true

control:
  heartbeat_interval_seconds: 5
  stale_after_seconds: 30
  cooperative_stop_grace_seconds: 15
  preserve_worktree_on_cancel: true
  require_confirmation_before_force_terminate_writer: true

approvals:
  group_identical_requests: true
  default_grant_expiry_minutes: 60
  maximum_group_size: 25
  reusable_grants_enabled: true
  never_reusable:
    - secrets
    - push_or_merge
    - deployment
    - destructive_action
    - auth_or_payment_change
    - database_migration

provider_strategy:
  mode: hybrid_selective
  prefer_subscription_for_implementation: true
  prefer_low_cost_api_for_bounded_review: true
  prefer_different_model_family_for_independent_verification: true

providers:
  claude-subscription:
    type: claude-cli

  cursor-subscription:
    type: cursor-cli

  codex-subscription:
    type: codex-app-server

  qwen-gateway:
    type: custom
    provider_name: Alibaba Cloud
    connection_name: Qwen Gateway
    protocol: openai-chat-completions
    base_url_env: QWEN_BASE_URL
    api_key_secret: qwen_gateway_key
    models:
      - id: qwen3.8-max-review
        display_name: Qwen 3.8 Max Review
        price_card: qwen-review-current

  xiaomi-gateway:
    type: custom
    provider_name: Xiaomi
    connection_name: MiMo Gateway
    protocol: openai-chat-completions
    base_url_env: XIAOMI_BASE_URL
    api_key_secret: xiaomi_gateway_key
    models:
      - id: mimo-v2.5-pro
        display_name: MiMo v2.5 Pro
        price_card: mimo-v25-current

roles:
  architect:
    provider: claude-subscription
    model: opus
    permission_profile: readonly-planner
    max_turns: 12

  plan_critic:
    provider: qwen-gateway
    model: qwen3.8-max-review
    permission_profile: readonly-reviewer
    fallback:
      provider: codex-subscription
      model: gpt-5.6-terra

  test_designer:
    provider: xiaomi-gateway
    model: mimo-v2.5-pro
    permission_profile: selected-files-readonly
    max_turns: 3

  implementer:
    provider: cursor-subscription
    model: grok-4.5-high
    permission_profile: workspace-writer

  verifier:
    provider: codex-subscription
    model: gpt-5.6-terra
    permission_profile: readonly-with-tests

  final_judge:
    provider: codex-subscription
    model: gpt-5.6-sol
    permission_profile: readonly-judge

workflows:
  critical:
    max_fix_loops: 2
    require_plan_approval: true
    require_merge_approval: true
    stages:
      - architect
      - plan_critic
      - architect_revision
      - test_designer
      - plan_approval
      - implementer
      - deterministic_checks
      - plan_critic_post_review
      - verifier
      - fix_loop
      - final_judge
      - merge_approval
```
---

## 31. Product Decisions Already Resolved


- The first task interaction is an intent chooser, not a graph editor.
- `new_product` and `review_changes` are supported task types.
- PRD, implementation plan, API specification, wireframe, screenshot, ticket, and reference uploads are optional inputs.
- Every supporting document has an authority level; blocking conflicts require typed clarification.
- A new product requires product understanding, architecture/plan approval, and milestone decomposition before implementation.
- The browser never invokes CLIs directly; the local daemon invokes user-installed Claude Code, Codex, and Cursor.
- Operational state, artefacts, approvals, audits, and knowledge remain local in MVP.
- Cloud providers receive selected context only when invoked under user-configured policy.
- Provider routing is subscription-first and capability-driven.
- Cursor is a default writer mapping, not a hard-coded writer requirement.
- Codex App Server is preferred for rich Codex integration when available.
- A full knowledge graph is post-MVP; typed local knowledge relationships are the migration path.

- Final public product name is **RoleFlock**.
- Public product domain is **roleflock.com**.
- Product endorsement is **RoleFlock by Mlola**.
- The local application runtime remains `http://127.0.0.1:4178`.
- RoleFlock and MemoSprout are sibling products under Mlola.
- Product is local-first.
- Subscription CLIs and user-defined Custom Providers are both first-class connections.
- Cursor is the default sole writer.
- Claude is the default architect.
- The Plan Critic role defaults to the configured Qwen example but can use any compatible model.
- The Test Designer role defaults to the configured MiMo example but can use any compatible model.
- Terra verifies.
- Sol judges critical work.
- Actual cost, shadow cost, and subscription allocation are separated.
- Quota values always show confidence.
- Human approval remains mandatory before merge.
- Qwen and Xiaomi are not hard-coded providers; both are editable Custom Provider examples.
- Workflows reference roles, while roles independently reference provider connections and model IDs.
- No browser scraping is required for MVP correctness.
- Unknown account-wide quota is displayed honestly rather than inferred.
- The default provider strategy is hybrid and selective; workflows do not invoke every configured provider by default.
- RoleFlock selects the smallest sufficient graph before execution.
- The active role, provider, configured model, permission profile, phase, and heartbeat are always visible.
- Every long-running node supports truthful stop semantics according to adapter capability.
- Agent confirmations use typed requests, not informal transcript questions.
- Identical safe requests may be grouped and covered by scoped, expiring, revocable approval grants.
- Sensitive actions require fresh per-occurrence approval in MVP.
- RoleFlock uses its own operational and minimal knowledge stores; MemoSprout is not an MVP dependency.

---

## 32. Open Product Questions for Implementation

These questions should be answered during Phase 0, not before beginning the UI and core architecture:

1. Which exact Claude plan and quota views are available on the user’s account?
2. Does the installed Codex version expose app-server rate-limit data to a local client?
3. Is the Cursor account Individual, Team, or Enterprise?
4. Which optional billing, balance, or quota endpoints are available for each Custom Provider connection?
5. Which price card and billing mode apply to each configured custom model?
6. What are the exact model aliases accepted by each installed CLI?
7. Which repositories require Docker sandboxing?
8. Which optional external knowledge adapter should be evaluated after the standalone MVP is stable?

The system must support these as configuration differences without changing the core workflow.


---

## 32A. Version 2.4 Acceptance Requirements


### Task intent and documents

- The user can choose Build a New Product, Add a Feature, Fix a Bug, Refactor Code, Investigate an Issue, or Review Existing Changes.
- A task can start without an uploaded document.
- PRD and implementation-plan uploads preserve original local files, hashes, authority levels, and citations.
- Conflicting authoritative inputs block implementation until resolved.
- A new-product task is decomposed into approved milestones before writer execution.

### Local execution and provider access

- The browser contains no direct CLI execution path.
- The daemon can discover and validate user-installed Claude Code, Codex, and Cursor adapters.
- Authentication remains owned by the corresponding CLI or OS keychain.
- RoleFlock works with one compatible provider and with multiple providers.
- Routing evaluates capabilities and policy rather than requiring a provider brand.
- Cursor writer runs in an isolated worktree with external enforcement.

### Local-first privacy and disclosure

- RoleFlock/Mlola does not receive repository contents in the local MVP.
- All operational data is stored locally unless the user explicitly enables a future cloud feature.
- Every cloud invocation has an inspectable disclosure manifest.
- Sensitive denied paths are excluded before context compilation.
- The UI never claims code stays fully on-device while a cloud model is active.

### Knowledge roadmap

- MVP stores immutable task evidence and local knowledge items without a graph database.
- Typed knowledge relations retain evidence provenance.
- MemoSprout remains optional.
- Knowledge or skill candidates cannot automatically mutate production prompts without evaluation and approval.


### Product identity

- All user-facing product labels use `RoleFlock`.
- Public documentation points to `https://roleflock.com`.
- Local runtime URLs remain on `127.0.0.1` and are never confused with the public website.
- New package scopes, runtime directories, environment variables, and database names use `roleflock`.
- No identifier from the previous working name is present in new source, tests, generated artefacts, or documentation.
- MemoSprout is shown only as an optional integration.

### Bounded loops

- Every cycle has a LoopPolicy.
- A retry must include concrete feedback.
- Maximum attempts, time, and cost are enforced.
- Exhaustion escalates, pauses, or fails deterministically.
- An infinite loop is impossible in a validated graph.

### Graph observability

- The UI shows current node and selected edge.
- Parallel branches are visible.
- Joins preserve disagreements.
- Attempts and costs are visible.
- Browser refresh does not lose state.

### Durable recovery

- Killing the daemon does not lose confirmed progress.
- Worktree and process state are reconciled.
- Paid invocations are not duplicated accidentally.
- Interrupted nodes display a clear recovery decision.

### Bug-fix correctness

- Reproduction evidence is stored.
- Regression test fails before the fix.
- Regression test passes after the fix.
- Existing required tests pass.
- Verdict links to objective evidence.

### Graph safety

- Only one writer holds a worktree lock.
- Required checks cannot be bypassed.
- Provider fallback is capability-compatible.
- Merge remains human-approved.


### Run control and transparency

- The active role, provider, configured model, phase, permission profile, heartbeat, and current action are visible.
- Pause, stop, force terminate, cancel, and emergency stop have distinct durable states.
- Stop requests are acknowledged within one second in the local UI.
- Completed reconciliation leaves no orphaned RoleFlock-owned child process.
- A stopped writer cannot retry before worktree and lock inspection.

### Confirmation and approvals

- Agents cannot grant themselves permission.
- Every confirmation uses a validated typed request.
- Identical requests are grouped only by security-relevant fingerprint.
- Approval grants have scope, risk ceiling, expiry, application limit, and revocation.
- Material state changes invalidate an old approval.
- Sensitive actions are never auto-approved by reusable grants in MVP.
- Approval application is idempotent.

### Evaluation

- Historical tasks can be replayed.
- Graph, prompt, model, context, and skill versions are comparable.
- Promotion retains metrics and transcripts.
- No skill candidate automatically mutates production instructions.

---

## 32B. Updated Delivery Plan

### Phase 0 — Technical validation

- Validate non-interactive CLI execution.
- Validate structured usage events.
- Validate custom provider calls.
- Validate cancellation.
- Validate worktree isolation.
- Validate event reducer and daemon recovery.
- Validate local browser authentication.
- Validate heartbeats, pause, cooperative stop, forced termination, cancel, emergency stop, and recovery.
- Validate confirmation fingerprints, grouping, grants, invalidation, and idempotency.

Exit criterion:

```text
One planner, one writer, one custom reviewer, and one verifier
complete a small bug-fix graph with one forced daemon restart.
```

### Phase 1 — Core graph MVP

- Graph schema and validator.
- Fast and Standard graphs.
- Nodes and conditional edges.
- Role/model mappings.
- Worktree locks.
- Live graph status with role/provider/model/phase identity.
- Run Control Manager and process reconciliation.
- Approval Inbox and typed confirmations.
- Cost and audit ledger.

### Phase 2 — Loop and critical workflows

- Outcome contract.
- Stage contract.
- Failure classification.
- Verification loop.
- Critical Feature graph.
- Bug Fix graph.
- Parallel read-only review.
- Join and evidence aggregation.
- Human approvals, grouped identical requests, and scoped approval grants.
- Quota routing.

### Phase 3 — Durable long work and context

- Context compiler.
- Context Inspector.
- Session handoffs.
- Fresh-context reset.
- Interruption recovery.
- Project knowledge store.

### Phase 4 — Evaluation and improvement

- Evaluation datasets.
- Replay engine.
- Versioned prompts, skills, and graphs.
- Lesson candidates.
- Skill registry.
- Regression alerts.
- Model-role performance dashboard.

### Phase 5 — Ecosystem

- Adaptive routing recommendations.
- Remote runners.
- GitHub or GitLab integration.
- Jira or Linear integration.
- Optional MemoSprout adapter.
- MCP interface.
- Team workspace and RBAC.
- Hosted coordination mode.


---

## 32C. Implementation Freeze and Change Process

After v2.2, the following core decisions are frozen for MVP:

- local-first web app plus local daemon;
- smallest-sufficient execution mode;
- one primary writer;
- provider-agnostic selective hybrid routing;
- deterministic verification before model judgement;
- durable events, runtime leases, and recovery;
- truthful active-execution monitoring;
- pause, stop, cancellation, and emergency-stop controls;
- typed confirmations and scoped approval grants;
- human merge authority;
- no MemoSprout runtime dependency.

New major ideas must be recorded as an RFC or post-MVP experiment. They must not expand the MVP unless they close a blocker discovered during implementation or validation.

---

## 33. Source-informed Implementation Notes

- Claude Code can expose estimated session cost and token information locally, and supports OpenTelemetry for monitoring. Subscription plan usage is also visible in Claude’s Usage settings, but RoleFlock should only automate account-wide quota when a supported machine-readable source is available.
- Codex exposes remaining usage in its user interfaces, and its app-server documentation includes quota window data such as used percentage and reset time.
- Cursor provides detailed usage and spending APIs for eligible team accounts. Individual account-wide usage may require dashboard or manual snapshot while RoleFlock still meters invocations it launches.
- Custom Provider endpoints may implement different protocols, usage fields, pricing, and quota systems. RoleFlock stores these as connection and model configuration rather than provider-specific product logic.
- Qwen and Xiaomi MiMo are example configurations. Their billing plans, balances, and package quotas remain separate ledgers when configured.

---

# End of RoleFlock PRD v2.4 — Brand-Finalised Implementation Baseline


---

## Appendix A — Source-informed Design Basis

The v2.0 architecture incorporates the following current agent-engineering findings:

- Loops are directed cyclic graphs rather than an alternative to graphs.
- Modern graph nodes can contain full coding-agent runs, not only one LLM call.
- Reliable systems mix deterministic operations, bounded model calls, and autonomous agent nodes.
- Verification loops improve consistency by grading output and returning concrete feedback.
- Long-running work benefits from decomposition, structured handoffs, and fresh context sessions.
- Separating generator and evaluator reduces lenient self-review.
- Session, harness, and execution environment should be decoupled.
- Durable event history permits recovery after process failure.
- Evaluation datasets should grow from real failures and remain core infrastructure.
- Execution and capability isolation are required when running agent-written code.

Reference works consulted:

- *3 Years of Graph Engineering with LangGraph* — LangChain, July 2026.
- *The Art of Loop Engineering* — LangChain, June 2026.
- *Harness Design for Long-running Application Development* — Anthropic, March 2026.
- *Scaling Managed Agents: Decoupling the Brain from the Hands* — Anthropic, April 2026.
- *Demystifying Evals for AI Agents* — Anthropic, January 2026.
- *What Is Temporal?* — Temporal documentation, 2026.
- *How Deep Agents Run Untrusted Code Without a Sandbox* — LangChain, June 2026.

# RoleFlock — Implementation Plan

**Version:** 1.0  
**Date:** 26 July 2026  
**Status:** Historical development-start baseline
**Based on:** RoleFlock PRD v2.4 — Development Start Baseline  
**Product:** RoleFlock by Mlola  
**Public website:** `https://roleflock.com`  
**Local application:** `http://127.0.0.1:4178`

> This plan records the orchestration-first implementation baseline that produced the
> current local beta. Product direction and future execution are now governed by
> [`roleflock_delivery_assurance_implementation_plan_v1.0.md`](roleflock_delivery_assurance_implementation_plan_v1.0.md)
> and ADR-014 through ADR-019. Existing safety, recovery, provider, approval, and
> local-first work remains valid.

---

## 1. Purpose

This document translates the frozen RoleFlock PRD into an executable engineering plan.

The implementation strategy is:

```text
Prove one safe vertical slice
→ harden control and recovery
→ generalise into graph runtime
→ add cost, quota, context, and knowledge
→ release a focused public MVP
```

The first release is not an unrestricted graph builder. It is a reliable local control plane that can:

1. register a local repository;
2. create an isolated Git worktree;
3. run a planner, writer, reviewer, and verifier;
4. show exactly which role, provider, configured model, phase, and command are active;
5. request typed confirmation;
6. pause, stop, force terminate, cancel, and recover safely;
7. preserve durable state through a forced daemon restart;
8. capture diff, tests, review findings, usage, cost, and provider disclosure;
9. require human approval before accepting the change.

---

## 2. Frozen Product Decisions

The following decisions are implementation constraints, not open design questions:

- RoleFlock is a local-first web application.
- The browser UI is served by a local daemon bound to `127.0.0.1`.
- The browser never invokes a CLI directly.
- User-installed Claude Code, Codex, and Cursor CLIs are invoked by the daemon.
- Custom HTTP providers and local model endpoints are supported.
- Provider routing is subscription-first, capability-driven, and provider-agnostic.
- The smallest sufficient execution mode is selected.
- Only one writer may own a task worktree.
- Deterministic verification precedes model judgement where possible.
- Every loop is bounded by attempts, time, cost, and an escalation path.
- Active role, provider, configured model, phase, heartbeat, permissions, and controls are always visible.
- Pause, stop, force terminate, cancel, and emergency stop are runtime primitives.
- Confirmation requests and approvals are typed, durable, scoped, and auditable.
- Identical requests may be grouped only by a security-relevant fingerprint.
- Sensitive actions cannot use broad reusable approvals.
- All operational data is stored locally in MVP.
- Source code is not sent to Mlola or a RoleFlock server.
- Selected context may be sent to model providers chosen by the user.
- MemoSprout is not an MVP dependency.
- A full knowledge graph is post-MVP.
- `roleflock.com` is the public website; local execution remains on localhost.

---

## 3. MVP Product Boundary

### 3.1 Included in the first public MVP

- Local daemon and local web UI.
- Repository registration.
- Git worktree isolation.
- Direct, Fast, Standard, and Bug Fix execution modes.
- Claude Code adapter.
- Codex App Server or CLI adapter.
- Cursor CLI adapter.
- Generic Custom Provider adapter.
- Role-to-provider/model mapping.
- Graph runtime with conditional edges.
- Bounded verification/fix loop.
- Deterministic command runner.
- Real-time execution monitoring.
- Typed confirmation requests.
- Approval Inbox.
- Grouped identical approvals.
- Scoped approval grants.
- Pause, stop, force terminate, cancel, and emergency stop.
- Durable event store and restart recovery.
- Actual cost and shadow cost ledger.
- Quota snapshots with confidence labels.
- Context disclosure manifest.
- Human acceptance gate.
- Audit and evidence export.
- Optional supporting documents for tasks.
- Build New Product intake and milestone planning, without fully autonomous multi-milestone execution.

### 3.2 Deferred

- Hosted team control plane.
- Remote runners.
- Team RBAC and SSO.
- Automatic merge or deployment.
- Free-form production graph editor.
- Automatic skill promotion.
- Full semantic/vector memory.
- Dedicated graph database.
- MemoSprout runtime integration.
- Jira, Linear, GitHub, or GitLab write integrations.
- Unbounded swarms.
- Autonomous production access.

---

## 4. Recommended Technical Architecture

## 4.1 Monorepo

Use a TypeScript monorepo with `pnpm` workspaces.

```text
roleflock/
├── apps/
│   ├── web/                         # Local React web UI
│   └── daemon/                      # Local HTTP server and runtime host
│
├── packages/
│   ├── contracts/                   # Shared schemas and event contracts
│   ├── graph-core/                  # Graph definitions and validation
│   ├── graph-runtime/               # Scheduler, reducers, transitions
│   ├── run-control/                 # Pause/stop/cancel/process management
│   ├── approval-engine/             # Confirmation, fingerprint, grants
│   ├── repository-runtime/          # Git repositories and worktrees
│   ├── command-runner/              # Typed deterministic commands
│   ├── provider-core/               # Provider adapter interfaces
│   ├── provider-claude/             # Claude Code adapter
│   ├── provider-codex/              # Codex App Server/CLI adapter
│   ├── provider-cursor/             # Cursor CLI adapter
│   ├── provider-custom/             # Generic HTTP provider adapter
│   ├── policy-engine/               # Permissions, budget, privacy
│   ├── context-compiler/            # Context selection and disclosure
│   ├── usage-ledger/                # Tokens, cost, quota, price cards
│   ├── evidence/                    # Diffs, test output, findings
│   ├── knowledge-store/             # Local knowledge items, later phase
│   ├── secret-store/                # OS keychain abstraction
│   ├── database/                    # SQLite schema and repositories
│   ├── observability/               # Logs, traces, metrics
│   └── test-support/                # Fixtures, fake providers, test repos
│
├── docs/
│   ├── adr/
│   ├── rfc/
│   ├── test-plans/
│   ├── security/
│   └── operations/
│
├── scripts/
├── fixtures/
├── roleflock.config.example.yaml
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

## 4.2 Concrete stack

### Local web UI

- Vite + React + TypeScript.
- TanStack Router.
- TanStack Query.
- Tailwind CSS.
- Accessible component primitives.
- Server-Sent Events for initial live event streaming.
- Monaco or CodeMirror only when diff/log editing requires it.
- A graph canvas library is deferred until the runtime is stable.

**Reason for Vite:** the local UI does not need server-side rendering; the public marketing website is separate.

### Daemon

- Node.js 24+ and TypeScript.
- Fastify HTTP server.
- Local authentication token generated at daemon start.
- Zod for internal validation.
- JSON Schema for external model outputs and graph contracts.
- Structured logger with redaction.
- Native child process APIs or a thin process wrapper.

### Persistence

- SQLite.
- Drizzle ORM or a thin SQL repository layer.
- Append-only event table.
- Reducer-generated snapshots.
- WAL mode.
- Explicit migrations.
- Local export/backup.

### Testing

- Vitest for unit and integration tests.
- Playwright for UI and end-to-end tests.
- Temporary Git repositories for repository-runtime tests.
- Fake CLI executables and fake HTTP providers.
- Process-tree test fixtures.
- Fault-injection helpers for crash and timeout tests.

---

## 5. Runtime Architecture

```text
Local browser
      │
      │ HTTP + SSE
      ▼
Local daemon
├── API and local auth
├── command bus
├── event store
├── state reducers
├── graph scheduler
├── run control
├── approval engine
├── provider adapters
├── repository runtime
├── context compiler
├── usage ledger
└── audit/evidence
      │
      ├── user-installed CLIs
      ├── configured HTTP providers
      └── local Git repositories
```

## 5.1 Command/query separation

The UI sends typed commands:

```text
CreateTask
StartGraphRun
PauseTask
StopNode
ForceTerminateNode
CancelTask
ResolveConfirmation
CreateApprovalGrant
RevokeApprovalGrant
RetryNode
AcceptTask
RejectTask
```

The UI reads projections:

```text
TaskSummary
GraphRunView
ActiveExecutionView
ApprovalInboxView
ProviderHealthView
UsageSummaryView
EvidenceBundleView
```

The UI must not issue raw shell commands.

## 5.2 Durable event flow

```text
Typed command
→ validate policy and current state
→ append command-request event
→ perform side effect
→ append outcome event
→ reducer updates projection
→ SSE pushes new projection/event
```

Side effects must not be considered complete until their outcome event is durably stored.

## 5.3 Idempotency

Stable keys:

```text
graph run:       task_id + graph_version
node attempt:    graph_run_id + node_id + attempt
invocation:      node_run_id + invocation_index
approval action: approval_request_id + decision_version
control action:  node_run_id + command_type + command_version
```

When the provider outcome is unknown after a crash, mark it:

```text
OUTCOME_UNKNOWN
```

Do not automatically retry a potentially billable invocation.

---

## 6. Core Domain Contracts

Implement contracts before provider code.

## 6.1 Task

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

interface Task {
  id: string;
  projectId: string;
  type: TaskType;
  title: string;
  brief: string;
  risk: "low" | "medium" | "high" | "critical";
  state: TaskState;
  workflowGraphVersionId: string;
  budgetPolicyId: string;
  createdAt: string;
  updatedAt: string;
}
```

## 6.2 Active execution

```typescript
interface ActiveExecution {
  graphRunId: string;
  nodeRunId: string;
  taskId: string;

  roleId: string;
  roleDisplayName: string;

  providerConnectionId: string;
  providerDisplayName: string;
  configuredModelId: string;
  configuredModelDisplayName: string;
  effort?: string;

  phase:
    | "preparing"
    | "compiling_context"
    | "waiting_for_provider"
    | "reasoning"
    | "reading"
    | "writing"
    | "running_tool"
    | "running_tests"
    | "awaiting_confirmation"
    | "stopping"
    | "recovering"
    | "finalising";

  permissionProfileId: string;
  currentActivity?: string;
  activeTool?: string;
  activeCommandPreview?: string;

  startedAt: string;
  lastHeartbeatAt: string;
  attempt: number;
  maxAttempts: number;

  actualCost?: number;
  shadowCost?: number;
  usageConfidence: UsageConfidence;

  pauseRequested: boolean;
  stopRequested: boolean;
  forceTerminationAvailable: boolean;
}
```

Configured model identity comes from the invocation configuration and adapter response, never from model self-identification.

## 6.3 Confirmation request

```typescript
interface ConfirmationRequest {
  id: string;
  taskId: string;
  graphRunId: string;
  nodeRunId: string;

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

  rationale: string;
  exactAction: StructuredAction;
  affectedPaths?: string[];
  commandPreview?: string;
  destination?: string;
  estimatedAdditionalCost?: number;
  riskClass: "low" | "medium" | "high" | "critical";

  stateHash: string;
  fingerprint: string;
  status: "pending" | "approved" | "rejected" | "expired" | "invalidated";
  createdAt: string;
}
```

## 6.4 Approval grant

```typescript
interface ApprovalGrant {
  id: string;
  projectId: string;
  scope:
    | "single_request"
    | "node_attempt"
    | "task"
    | "task_request_type"
    | "repository_session"
    | "exact_fingerprint";

  fingerprint?: string;
  requestTypes?: string[];
  allowedPathPatterns?: string[];
  allowedCommandTemplates?: string[];
  allowedDestinations?: string[];

  maximumRisk: "low" | "medium" | "high";
  maximumAdditionalCost?: number;
  maximumApplications?: number;
  applicationsUsed: number;

  expiresAt: string;
  revokedAt?: string;
  createdBy: string;
}
```

Never reuse approval for:

- secret access;
- push or merge;
- deployment;
- production access;
- destructive command;
- authentication/authorisation changes;
- payment or credit mutation;
- write-effect migration;
- public API breaking change;
- disabling required tests/security;
- overriding a critical hard budget.

## 6.5 Provider adapter

```typescript
interface ProviderAdapter {
  readonly id: string;
  readonly connectionType:
    | "cli"
    | "app-server"
    | "openai-compatible"
    | "anthropic-compatible"
    | "custom-http";

  healthCheck(): Promise<ProviderHealth>;
  detectCapabilities(): Promise<AdapterCapabilities>;
  listModels(): Promise<ModelDescriptor[]>;
  invoke(request: InvocationRequest): AsyncIterable<InvocationEvent>;
  cancel(invocationId: string): Promise<CancelResult>;

  getUsageSnapshot?(): Promise<UsageSnapshot>;
  getQuotaSnapshot?(): Promise<QuotaSnapshot>;
}
```

## 6.6 Normalised invocation events

```typescript
type InvocationEvent =
  | { type: "invocation.started"; invocationId: string }
  | { type: "model.output.delta"; text: string }
  | { type: "phase.changed"; phase: ActiveExecution["phase"]; detail?: string }
  | { type: "heartbeat"; at: string }
  | { type: "tool.requested"; tool: string; input: unknown }
  | { type: "tool.started"; tool: string }
  | { type: "tool.completed"; tool: string; outputRef?: string }
  | { type: "confirmation.requested"; request: ConfirmationRequestDraft }
  | { type: "usage.updated"; usage: UsageDelta }
  | { type: "quota.updated"; quota: QuotaSnapshot }
  | { type: "invocation.interrupted"; reason: string }
  | { type: "invocation.completed"; output: unknown }
  | { type: "invocation.failed"; error: NormalisedProviderError };
```

---

## 7. Database Plan

## 7.1 First migration

Create:

- `workspaces`
- `projects`
- `repositories`
- `tasks`
- `workflow_graphs`
- `graph_versions`
- `graph_runs`
- `workflow_nodes`
- `workflow_edges`
- `node_runs`
- `loop_attempts`
- `events`
- `state_snapshots`
- `roles`
- `provider_connections`
- `models`
- `role_model_mappings`
- `runtime_leases`
- `process_handles`
- `active_executions`
- `control_commands`
- `confirmation_requests`
- `approval_groups`
- `approvals`
- `approval_grants`
- `worktrees`
- `invocations`
- `usage_ledger_entries`
- `quota_snapshots`
- `price_cards`
- `artefacts`
- `test_runs`
- `review_findings`
- `audit_events`
- `data_disclosure_manifests`

## 7.2 Event storage

`events` is append-only:

```text
id
aggregate_type
aggregate_id
sequence
event_type
payload_json
metadata_json
created_at
```

Constraints:

- unique `(aggregate_id, sequence)`;
- immutable after insert;
- event schema version in metadata;
- actor and causation/correlation IDs;
- optional idempotency key.

## 7.3 Snapshots

Snapshots are projections, not truth:

```text
aggregate_id
last_sequence
state_json
created_at
```

Start with snapshot every 50 events or at terminal node boundaries. Make the threshold configurable after profiling.

---

## 8. API Plan

## 8.1 Phase 0 endpoints

```text
GET    /api/health
GET    /api/runtime/info
GET    /api/events/stream

POST   /api/projects
GET    /api/projects
POST   /api/projects/:id/validate

POST   /api/tasks
GET    /api/tasks
GET    /api/tasks/:id
POST   /api/tasks/:id/start
POST   /api/tasks/:id/pause
POST   /api/tasks/:id/resume
POST   /api/tasks/:id/cancel

GET    /api/runs/:id
GET    /api/runs/:id/events
GET    /api/runs/:id/active-execution

POST   /api/nodes/:id/stop
POST   /api/nodes/:id/force-terminate
POST   /api/nodes/:id/retry

GET    /api/approvals
POST   /api/approvals/:id/approve
POST   /api/approvals/:id/reject
POST   /api/approvals/:id/request-changes
POST   /api/approval-groups/:id/approve-all-once
POST   /api/approval-grants
POST   /api/approval-grants/:id/revoke

GET    /api/providers
POST   /api/providers
POST   /api/providers/:id/health-check
GET    /api/providers/:id/capabilities
GET    /api/providers/:id/models

GET    /api/evidence/tasks/:taskId
GET    /api/usage/tasks/:taskId
```

## 8.2 Local API security

- Bind to `127.0.0.1`.
- Generate a random local session token.
- Set a secure, same-origin cookie or token header.
- Reject unknown origins.
- Use CSRF protection for mutations.
- No raw shell endpoint.
- No arbitrary filesystem path read endpoint.
- Validate every request with schemas.
- Apply rate limits to mutating and control endpoints.
- Redact sensitive values in errors.

---

## 9. Implementation Milestones

Planning estimates are directional for one experienced developer using AI coding assistance. They are not delivery promises.

---

# Milestone 0 — Repository Bootstrap

**Estimate:** 2–3 developer days

## Objectives

- Create monorepo.
- Establish quality gates.
- Create local daemon and local web shell.
- Document architecture decisions.

## Tasks

1. Initialise Git repository and `pnpm` workspace.
2. Create `apps/web`, `apps/daemon`, and core packages.
3. Configure TypeScript project references.
4. Configure lint, format, test, and typecheck commands.
5. Add CI for lint, typecheck, unit tests, and build.
6. Create Fastify daemon with `/api/health`.
7. Bind to `127.0.0.1:4178`.
8. Serve the local web build through the daemon or configured local dev proxy.
9. Add local session token generation.
10. Add structured logging and redaction.
11. Create ADR index.
12. Add `CONTRIBUTING.md`, security notes, and repository conventions.

## Acceptance gate

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- The daemon listens only on localhost.
- The local UI displays daemon health and runtime version.
- A test proves a non-local bind is not the default.
- No raw command execution endpoint exists.

---

# Milestone 1 — Contracts, Event Store, and State Reducers

**Estimate:** 5–7 developer days

## Objectives

- Define durable domain contracts.
- Implement SQLite event store.
- Implement reducers and snapshots.
- Make every state transition testable without a provider.

## Tasks

1. Implement IDs and time abstractions.
2. Implement task, graph, node, invocation, control, confirmation, approval, and usage schemas.
3. Create first database migration.
4. Implement append-only event repository.
5. Implement optimistic sequence checking.
6. Implement idempotency-key handling.
7. Implement reducers for:
   - Task;
   - GraphRun;
   - NodeRun;
   - Approval;
   - RunControl;
   - ProviderConnection.
8. Implement snapshot repository.
9. Implement replay from events.
10. Add corruption and schema-version detection.
11. Add database backup/export command.
12. Add fake clock and deterministic IDs in tests.

## Acceptance gate

- Replaying all events produces the same projection.
- Duplicate command with same idempotency key does not duplicate state.
- Invalid transition is rejected.
- Snapshot plus remaining events equals full replay.
- Killing the process after event append but before projection update recovers correctly.
- Event records cannot be updated or deleted through application repositories.

---

# Milestone 2 — Repository Registration and Worktree Runtime

**Estimate:** 5–7 developer days

## Objectives

- Safely access user-selected repositories.
- Create task worktrees.
- Enforce one writer.
- Capture repository evidence.

## Tasks

1. Register repository with resolved real path.
2. Validate Git repository and base branch.
3. Detect dirty base repository.
4. Add project allow/deny path policy.
5. Resolve symlinks before access decisions.
6. Create task branch naming policy.
7. Create and archive/delete Git worktrees.
8. Implement one-writer lease.
9. Capture pre-run Git status and commit hash.
10. Capture changed files, patch, diff stats, and final status.
11. Implement dirty-worktree preservation after cancellation.
12. Add safe cleanup flow.
13. Add temporary-repository test fixtures.

## Acceptance gate

- Two writers cannot acquire the same task worktree.
- A planner/reviewer cannot obtain write capability.
- `.env*`, keys, and configured denied paths are excluded.
- A symlink escape test is denied.
- Cancelling a task preserves an inspectable dirty worktree.
- Base repository remains unchanged.
- Worktree state can be recovered after daemon restart.

---

# Milestone 3 — Run Control and Process Supervision

**Estimate:** 7–10 developer days

## Objectives

- Run and monitor child processes truthfully.
- Implement pause/stop/force/cancel semantics.
- Reconcile process trees after crash.

## Tasks

1. Implement `RuntimeLease`.
2. Implement `ProcessHandle`.
3. Implement heartbeat updates.
4. Implement active-execution projection.
5. Implement cooperative stop request.
6. Implement grace period and forced termination.
7. Implement task cancellation.
8. Implement emergency stop.
9. Implement process-tree discovery and termination.
10. Implement stale-lease detection.
11. Implement orphaned-process reconciliation on daemon start.
12. Implement `OUTCOME_UNKNOWN` state.
13. Implement command status lifecycle:
    - requested;
    - acknowledged;
    - stopping;
    - completed;
    - failed.
14. Add fault injection:
    - daemon kill;
    - child hang;
    - parent death;
    - output stream truncation;
    - command timeout.

## Acceptance gate

- Stop request is durably acknowledged.
- Active node displays last heartbeat.
- A hung process can be force terminated.
- RoleFlock-owned child processes do not remain after emergency stop.
- Unknown provider outcome is not silently retried.
- Dirty worktree remains inspectable.
- Restart reconciliation yields a truthful state.

---

# Milestone 4 — Provider Core and Custom HTTP Adapter

**Estimate:** 5–7 developer days

## Objectives

- Normalise provider capabilities and events.
- Prove the adapter contract with a controllable HTTP provider.
- Add usage and disclosure capture.

## Tasks

1. Implement provider registry.
2. Implement capability detection contract.
3. Implement provider health checks.
4. Implement configured model identity.
5. Implement Generic Custom Provider configuration:
   - protocol;
   - base URL;
   - API key reference;
   - model IDs;
   - custom headers;
   - extra request body;
   - timeout;
   - retry;
   - concurrency;
   - pricing.
6. Implement OpenAI-compatible request/response path.
7. Implement streaming normalisation.
8. Implement structured output validation and repair limit.
9. Implement HTTP cancellation through abort signals.
10. Implement usage extraction.
11. Implement rate-limit header parsing.
12. Implement disclosure manifest.
13. Implement fake provider server for tests.

## Acceptance gate

- A custom provider can stream events into the standard event contract.
- Cancellation closes the request and produces an interrupted outcome.
- Usage and cost are attributed to one invocation.
- Invalid structured output is handled within a bounded repair policy.
- The configured provider/model is visible in active execution.
- Disclosure manifest records selected context and exclusions.

---

# Milestone 5 — CLI and App-Server Adapters

**Estimate:** 12–18 developer days total

Implement each adapter behind the same contract. Do not build UI-specific provider logic.

## 5A. Codex adapter

**Estimate:** 4–6 days

### Tasks

- Discover installed executable.
- Start and supervise App Server where available.
- Implement protocol transport.
- Discover models/capabilities.
- Start thread/turn.
- Stream model, tool, and command events.
- Bridge native approvals to ConfirmationRequest.
- Interrupt active turn.
- Capture usage/quota when exposed.
- Classify app-server and process failures.
- Test restart and interrupted turn behaviour.

### Exit gate

- One read-only verifier run completes.
- A native approval appears in Approval Inbox.
- Interrupt produces a truthful interrupted state.
- Model identity comes from configuration/discovery.
- App-server failure does not corrupt task state.

## 5B. Claude Code adapter

**Estimate:** 3–5 days

### Tasks

- Discover executable and version.
- Detect authentication health.
- Implement programmatic/headless invocation.
- Configure model, effort, permission mode, output mode, and session ID.
- Parse structured stream events.
- Implement permission bridge where supported.
- Implement process-level cancellation.
- Capture usage/quota with correct confidence.
- Implement session resume only when proven.
- Add planner read-only profile.

### Exit gate

- Claude can perform repository planning without write access.
- Typed permission request appears in RoleFlock.
- Stop terminates the owned process tree.
- Unsupported quota or resume capability is shown honestly.

## 5C. Cursor adapter

**Estimate:** 5–7 days

### Tasks

- Discover executable and login state.
- Implement invocation and structured output parsing where available.
- Create writer permission envelope.
- Run only inside task worktree.
- Enforce denied paths outside the model.
- Enforce command policy outside the model.
- Capture process tree and heartbeat.
- Implement stop and force terminate.
- Preserve partial changes.
- Test session resume only if reliable.
- Add optional PTY parser only as a non-security fallback.

### Exit gate

- Cursor cannot write outside the task worktree.
- Cursor cannot read denied secrets through RoleFlock-managed access.
- Stop preserves partial diff.
- The UI describes cancellation/approval capability truthfully.
- One implementation task completes under a writer lease.

---

# Milestone 6 — Typed Commands, Confirmations, and Approval Inbox

**Estimate:** 7–10 developer days

## Objectives

- Make agent confirmations smooth and safe.
- Support identical incoming approvals.
- Preserve decisions through refresh and restart.

## Tasks

1. Implement `StructuredAction`.
2. Implement ConfirmationRequest validation.
3. Implement security fingerprint canonicalisation.
4. Include:
   - project/repository;
   - request type;
   - permission profile;
   - path scope;
   - command and argument pattern;
   - network destination;
   - side-effect class;
   - risk;
   - cost ceiling;
   - relevant state hash.
5. Implement ApprovalGroup.
6. Implement Approve Once.
7. Implement Approve All Identical Pending Requests Once.
8. Implement scoped ApprovalGrant.
9. Implement expiry, max applications, and revocation.
10. Implement sensitive-action non-reuse policy.
11. Implement state-change invalidation.
12. Implement idempotent approval application.
13. Implement Approval Inbox UI.
14. Implement task/node resume after approval.
15. Implement batch decision audit trail.

## Acceptance gate

- Identical requests group only when fingerprints match.
- A material command/path/destination change requires a fresh approval.
- Approval survives browser refresh and daemon restart.
- One grant can approve compatible future requests within its limits.
- Revoked or expired grants do not apply.
- Sensitive actions always request a fresh decision.
- Resume reacquires leases and revalidates state.

---

# Milestone 7 — Walking Skeleton: Verified Bug Fix

**Estimate:** 7–10 developer days

This is the Phase 0 product proof.

## Flow

```text
Create Bug Fix Task
→ Claude Planner
→ Custom Plan Reviewer
→ Optional typed confirmation
→ Cursor Writer
→ Deterministic Regression Test
→ Codex Verifier
→ Human Accept/Reject
```

## UI scope

### New task

- Project.
- Bug description.
- Expected behaviour.
- Actual behaviour.
- Optional logs/screenshots/reference files.
- Budget.
- Maximum attempts.
- Role/model preview.
- Context/provider disclosure preview.

### Task detail

Always show:

```text
Current phase
Role
Provider
Configured model
Effort
Permission profile
Current activity
Active tool/command
Elapsed time
Heartbeat
Attempt
Actual/shadow cost
Pending confirmation
Pause/Stop/Force/Cancel controls
```

### Evidence

- Plan.
- Reviewer finding.
- Changed files.
- Patch/diff.
- Test command.
- Before-fix result.
- After-fix result.
- Existing test result.
- Verifier verdict.
- Disclosure manifest.
- Usage/cost ledger.
- Human decision.

## Mandatory forced-failure scenario

During the writer or verifier run:

1. forcibly kill the daemon;
2. restart it;
3. reconcile worktree, process, leases, and event state;
4. continue from the last confirmed boundary;
5. do not duplicate a paid invocation.

## Phase 0 exit gate

- One real small repository bug is completed.
- Planner, writer, custom reviewer, and verifier all run.
- Active role/provider/model is always visible.
- Pause/stop works truthfully.
- No orphaned writer process remains.
- Worktree remains safe.
- Approval survives restart.
- No duplicate billable invocation occurs.
- Final evidence bundle is inspectable.
- All mandatory integration tests pass.

Do not proceed to a general graph runtime until this gate passes.

---

# Milestone 8 — Graph Runtime and Smallest-Sufficient Routing

**Estimate:** 10–14 developer days

## Objectives

- Generalise the walking skeleton into a versioned graph runtime.
- Support Direct, Simple Loop, Fixed Graph, and Critical Graph.
- Reject unsafe graphs.

## Tasks

1. Implement graph schema.
2. Implement graph versioning.
3. Implement node types:
   - agent;
   - model call;
   - command;
   - test;
   - router;
   - join;
   - human approval;
   - context compile;
   - evidence aggregate.
4. Implement typed conditional edges.
5. Implement graph validator.
6. Reject:
   - parallel writers;
   - unbounded cycles;
   - no terminal node;
   - pass paths bypassing required checks;
   - invalid state references;
   - incompatible fallback.
7. Implement scheduler.
8. Implement dependency resolution.
9. Implement concurrency limits.
10. Implement bounded local loops.
11. Implement failure classification and routing.
12. Implement graph necessity gate.
13. Implement templates:
    - Direct;
    - Fast;
    - Standard;
    - Bug Fix;
    - Critical Feature.
14. Add read-only graph run visualisation.

## Acceptance gate

- No validated graph can contain an infinite unbounded cycle.
- Only one writer can be scheduled per worktree.
- Required deterministic failure blocks PASS.
- Failure routes to the correct node class.
- Direct mode does not invoke unnecessary reviewers.
- Graph version remains immutable for a running task.
- Restart recovery resumes scheduler state.

---

# Milestone 9 — Cost, Quota, Budget, and Routing

**Estimate:** 7–10 developer days

## Objectives

- Track real and estimated usage.
- Make budget and quota first-class scheduling inputs.
- Avoid misleading users.

## Tasks

1. Implement price cards and versions.
2. Implement actual cost.
3. Implement shadow cost.
4. Implement optional allocated subscription cost.
5. Implement usage confidence:
   - exact provider;
   - exact local app server;
   - metered locally;
   - estimated;
   - manual snapshot;
   - unknown.
6. Implement quota snapshots.
7. Implement reset timestamps.
8. Implement task/node/loop budgets.
9. Implement warnings and hard stops.
10. Implement subscription reserve policy.
11. Implement provider health and fallback routing.
12. Implement cost-per-accepted-change projection.
13. Implement cost and quota UI.

## Acceptance gate

- Actual and shadow cost are never combined as one expected bill.
- Ledger sum equals task cost.
- Every quota value shows source/confidence.
- Local usage is not presented as account-wide usage.
- Budget can stop the next invocation.
- Required critical verification is not silently skipped.
- Provider substitution is visible and audited.

---

# Milestone 10 — Task Intents and Supporting Documents

**Estimate:** 7–10 developer days

## Objectives

- Provide a simple product-facing task intake.
- Support optional PRD and implementation plan uploads.
- Resolve conflicting requirements before writing.

## Tasks

1. Build intent chooser:
   - Build a New Product;
   - Add a Feature;
   - Fix a Bug;
   - Refactor Code;
   - Investigate;
   - Review Existing Changes.
2. Implement local file upload and hashing.
3. Implement document metadata and authority:
   - authoritative requirement;
   - approved plan;
   - reference;
   - inspiration only.
4. Implement text extraction for supported formats.
5. Preserve original file locally.
6. Store source citations.
7. Implement requirement extraction model call.
8. Implement conflict detection.
9. Implement typed clarification.
10. Generate Outcome Contract.
11. Generate Stage Contract.
12. Implement human plan approval for new product/critical feature.
13. Implement milestone decomposition for new product.
14. Create separate task per approved milestone.

## Acceptance gate

- A task can start without an uploaded document.
- Original files and hashes are preserved locally.
- Extracted requirements cite their source.
- Conflicting authoritative requirements block implementation.
- User resolves conflicts through typed choices.
- New-product work is decomposed before writer execution.

---

# Milestone 11 — Context Compiler and Local Knowledge Foundation

**Estimate:** 8–12 developer days

## Objectives

- Send only relevant context.
- Make provider disclosure inspectable.
- Start local reusable knowledge without a graph database.

## Tasks

1. Implement repository map artefact.
2. Implement role contract templates.
3. Implement context source selection.
4. Implement token budget.
5. Implement progressive disclosure.
6. Implement previous-attempt evidence selection.
7. Implement DataDisclosureManifest.
8. Implement Context Inspector.
9. Implement local knowledge items:
   - architecture decision;
   - coding convention;
   - past failure;
   - review rule;
   - test pattern;
   - security rule;
   - rejected approach.
10. Implement full-text retrieval.
11. Implement source/evidence links.
12. Implement candidate/published states.
13. Add typed relationships without a graph database.
14. Defer automatic prompt mutation.

## Acceptance gate

- Every cloud invocation has a disclosure manifest.
- Denied files are absent before provider invocation.
- Context source and token contribution are inspectable.
- Relevant knowledge can be retrieved by project/path/type.
- Knowledge retains provenance.
- Knowledge cannot automatically modify production skills.

---

# Milestone 12 — Security, Audit, Packaging, and Public MVP

**Estimate:** 10–15 developer days

## Objectives

- Harden the local security boundary.
- Package the product.
- Publish a focused MVP.

## Tasks

1. Perform threat modelling.
2. Add secret scanning and log redaction tests.
3. Add path traversal and symlink tests.
4. Add CSRF, origin, and local-auth tests.
5. Add command injection tests.
6. Add prompt injection boundary tests.
7. Add database backup/export/delete.
8. Add audit export.
9. Add evidence bundle export.
10. Add installer/start command.
11. Add version/update check without sending repository data.
12. Add privacy onboarding.
13. Add provider disclosure grants.
14. Add crash recovery documentation.
15. Add support diagnostics export with redaction.
16. Add public documentation at `roleflock.com`.
17. Add focused onboarding around Verified Fix.
18. Run baseline benchmark against direct-agent usage.

## Public MVP exit gate

- Phase 0 and graph-runtime acceptance suites pass.
- No critical security finding remains.
- No known writer-collision or orphan-process defect remains.
- Users can install, connect providers, register a repo, and complete Verified Fix.
- Privacy claims match actual data flow.
- Cost and quota labels are truthful.
- Local data can be exported and deleted.
- Recovery documentation is tested.
- Benchmark results are recorded without unsupported marketing claims.

---

## 10. Phase 0 Detailed Backlog

Use the accompanying CSV as the issue-import source.

Recommended epic order:

```text
RF-P0-E01 Repository Bootstrap
RF-P0-E02 Contracts and Event Store
RF-P0-E03 Repository Runtime
RF-P0-E04 Run Control
RF-P0-E05 Provider Core
RF-P0-E06 Codex Adapter
RF-P0-E07 Claude Adapter
RF-P0-E08 Cursor Adapter
RF-P0-E09 Approval Engine
RF-P0-E10 Verified Fix UI
RF-P0-E11 Forced Restart and Exit Gate
```

---

## 11. ADRs Required Before or During Phase 0

Create these as short decision records. Do not delay implementation waiting for perfect documentation.

### ADR-001 — Monorepo and package boundaries

Decision:

- `pnpm` workspaces;
- apps separated from domain packages;
- no provider-specific code in graph runtime or UI.

### ADR-002 — Local web stack

Proposed:

- Vite + React;
- Fastify daemon;
- SSE initially;
- public website separate.

### ADR-003 — Event store and reducer model

Decide:

- event envelope;
- sequencing;
- snapshot threshold;
- schema version migration;
- idempotency.

### ADR-004 — Process supervision and cancellation

Define:

- process group strategy;
- heartbeat;
- cooperative stop;
- grace period;
- forced termination;
- restart reconciliation.

### ADR-005 — Worktree locking and recovery

Define:

- branch/worktree naming;
- lease storage;
- dirty worktree policy;
- cleanup/archive;
- user edits during run.

### ADR-006 — Approval fingerprint

Define canonical serialisation and fields that invalidate reuse.

### ADR-007 — Secret storage

Define OS keychain abstraction, failure behaviour, and migration.

### ADR-008 — Provider event contract

Define normalised events, unsupported capabilities, cancellation, and usage confidence.

### ADR-009 — Local UI authentication

Define token creation, cookie/header strategy, CSRF, and origin policy.

### ADR-010 — Unknown billable invocation outcome

Define retry prohibition, user choices, and audit display.

### ADR-011 — Context disclosure manifest

Define selected sources, exclusions, provider identity, and retention.

### ADR-012 — Cursor writer sandbox

Define enforced filesystem, command, network, and process boundaries.

---

## 12. Testing Strategy

## 12.1 Test pyramid

### Unit tests

- reducers;
- graph validation;
- fingerprint canonicalisation;
- grant matching;
- budget policy;
- provider normalisation;
- path policy;
- cost calculation.

### Component/integration tests

- SQLite repositories;
- Git worktrees;
- child process supervisor;
- fake CLI adapter;
- fake HTTP provider;
- approval resume;
- SSE projections;
- crash recovery.

### End-to-end tests

- create task;
- run provider;
- approve request;
- stop/cancel;
- inspect evidence;
- restart daemon;
- resume;
- accept/reject task.

### Fault-injection tests

- daemon crash;
- child process hang;
- provider timeout;
- malformed stream;
- invalid structured output;
- database busy;
- stale lease;
- orphan process;
- lost network;
- user-modified worktree;
- low quota;
- hard budget exceeded.

## 12.2 Mandatory security tests

- path traversal;
- symlink escape;
- shell injection;
- secret file access;
- cross-origin mutation;
- forged approval decision;
- fingerprint collision attempt;
- stale approval after worktree change;
- broad grant applied to sensitive action;
- malicious repository prompt instruction;
- provider output containing fake control events.

## 12.3 Golden test repositories

Create small fixtures:

```text
fixtures/repos/
├── typescript-simple-bug/
├── node-webhook-race/
├── git-dirty-base/
├── symlink-escape/
├── long-running-test/
└── approval-required/
```

Each fixture has:

- known failing test;
- expected patch;
- expected changed files;
- expected command output;
- expected acceptance criteria.

---

## 13. Observability Plan

## 13.1 Local logs

Structured fields:

```text
timestamp
level
task_id
graph_run_id
node_run_id
invocation_id
provider
configured_model
role
phase
event_type
duration
error_category
```

Never log:

- API keys;
- OAuth tokens;
- raw secret files;
- unredacted command environment;
- full provider request by default.

## 13.2 Trace hierarchy

```text
Task
└── Graph Run
    ├── Node Run
    │   ├── Invocation
    │   ├── Tool Call
    │   └── Loop Attempt
    └── Edge Transition
```

## 13.3 Metrics

- graph completion rate;
- node success;
- first-attempt pass;
- average attempts;
- cost per accepted change;
- actual/shadow cost;
- stop completion time;
- orphan process count;
- restart recovery rate;
- approval wait time;
- grouped approval count;
- grant auto-apply count;
- false-pass/false-block rate;
- provider failure/fallback rate.

---

## 14. Security Model

## 14.1 Trust zones

```text
Trusted:
- RoleFlock daemon core
- local database repositories
- policy engine
- approval engine

Constrained:
- child CLI processes
- deterministic commands
- task worktree

Untrusted:
- repository content
- model output
- external documents
- provider streams
- generated shell commands
```

## 14.2 Enforcement order

```text
User/project policy
→ graph/node permission profile
→ approval grant
→ runtime action validation
→ OS/filesystem/process enforcement
→ execution
→ audit
```

A prompt cannot expand permissions.

## 14.3 Safe defaults

- read-only planner/reviewer;
- one writer;
- network denied except configured providers and explicit project grants;
- no push, merge, deploy, or production access;
- denied secret patterns;
- maximum output and runtime;
- explicit package/dependency mutation confirmation;
- preserve evidence after interruption.

---

## 15. Product UI Implementation Order

Do not start with a complex graph editor.

### UI 1 — Setup

- daemon health;
- repository registration;
- provider connection tests;
- role mappings.

### UI 2 — New Task

- task intent;
- brief;
- optional documents;
- risk;
- budget;
- workflow preview;
- provider disclosure.

### UI 3 — Active Task

- current phase;
- role/provider/model;
- heartbeat;
- command/tool;
- attempts;
- cost/quota;
- controls;
- live logs.

### UI 4 — Approval Inbox

- grouped requests;
- exact action;
- rationale;
- risk;
- scope;
- approve once;
- approve identical pending;
- create scoped grant;
- reject.

### UI 5 — Evidence and Decision

- diff;
- tests;
- findings;
- disclosure;
- usage;
- accept/reject/request changes.

### UI 6 — Dashboard and Analytics

Only after the walking skeleton is stable.

---

## 16. First 20 Commits

A practical starting sequence:

```text
1.  chore: initialise RoleFlock pnpm monorepo
2.  chore: add lint typecheck test and build pipelines
3.  feat: add localhost Fastify daemon and health endpoint
4.  feat: add local web shell and daemon connection status
5.  docs: add initial ADR index and development conventions
6.  feat: add shared IDs schemas and event envelope
7.  feat: add SQLite migrations and append-only event store
8.  feat: add task and graph-run reducers
9.  test: add replay idempotency and snapshot tests
10. feat: add repository registration and path policy
11. feat: add Git worktree manager and writer lease
12. test: add symlink escape and writer collision tests
13. feat: add process handle runtime lease and heartbeat
14. feat: add stop force-terminate and restart reconciliation
15. test: add hung process and forced daemon restart fixtures
16. feat: add provider adapter contract and fake provider
17. feat: add custom HTTP provider streaming adapter
18. feat: add active execution projection and SSE stream
19. feat: add typed confirmation and approval persistence
20. feat: add minimal Approval Inbox UI
```

After commit 20, integrate Codex, Claude, and Cursor in separate, reviewable commits.

---

## 17. Definition of Done

A backlog item is done only when:

- acceptance criteria pass;
- schemas are validated;
- unit/integration tests exist;
- failure behaviour is tested;
- logs are redacted;
- audit events are emitted;
- unsupported capabilities are disclosed;
- documentation is updated;
- no new critical security issue is introduced.

A provider adapter is done only when:

- health check works;
- configured model is visible;
- stream events are normalised;
- stop/cancel behaviour is proven;
- process failure is classified;
- usage confidence is correct;
- disclosure manifest is created;
- restart behaviour is tested;
- unsupported features are not advertised.

---

## 18. Development Workflow

Use:

```text
PRD   → frozen product contract
ADR   → technical decision
RFC   → product or architecture expansion
Issue → implementation work
Test report → evidence
```

Branching:

```text
main
└── feat/<issue-id>-<short-description>
```

Each milestone should end with:

1. integration test report;
2. unresolved risks;
3. ADR updates;
4. demo recording or screenshots;
5. go/no-go decision for next milestone.

---

## 19. Timeline View

Directional solo-developer estimate:

```text
Milestone 0–3   Foundation and safe runtime        3–4 weeks
Milestone 4–7   Providers, approvals, Phase 0      4–6 weeks
Milestone 8–10  Graphs, cost/quota, task intake    4–6 weeks
Milestone 11–12 Context, hardening, public MVP      4–6 weeks
```

Total:

```text
Focused public MVP: approximately 15–22 developer weeks
```

AI coding assistance may accelerate implementation, but cancellation, process supervision, security, and crash recovery should not be compressed by skipping tests.

A smaller private alpha can begin immediately after Milestone 7.

---

## 20. Immediate Next Actions

Start with these actions:

1. Create the `roleflock` repository.
2. Copy the PRD, this implementation plan, and the Phase 0 checklist into `docs/`.
3. Create ADR-001 through ADR-005.
4. Initialise the monorepo.
5. Implement the daemon health endpoint and local web shell.
6. Implement contracts and event store.
7. Build process supervision before real provider adapters.
8. Build repository/worktree isolation before enabling a writer.
9. Implement a fake provider and fake CLI for deterministic tests.
10. Integrate real providers only after the runtime contract is testable.

The first product demo should be:

```text
A real bug fix
with a visible planner, writer, reviewer, and verifier,
one approval request,
one stop/restart event,
and a complete evidence bundle.
```

---

# End of Implementation Plan

# Roflock Open Source — AI Build Backlog v1.0

**Companion to:** Roflock Open Source PRD v1.0  
**Purpose:** Atomic implementation sequence for an AI coding harness.  
**Rule:** Complete prerequisites before dependent tasks. One logical task per commit.

---

## Status legend

- `DONE` — current foundation already exists and must be preserved/integrated.
- `NEXT` — first implementation queue.
- `PLANNED` — authorized after prerequisites.
- `DEFERRED` — intentionally outside current development phase.

---

# M0 — Foundation integration

### RF-M0-001 — Import current Graph IR package

**Status:** NEXT  
**Goal:** Move existing `@roflock/graph-ir` foundation into canonical monorepo.  
**Acceptance:** strict typecheck and existing 12 Graph IR tests pass unchanged or with path-only changes.

### RF-M0-002 — Import current Language package

**Status:** NEXT  
**Depends:** RF-M0-001  
**Acceptance:** tokenizer/parser/AST/compiler integrated and existing 6 language tests pass.

### RF-M0-003 — Root workspace bootstrap

**Status:** NEXT  
**Acceptance:** pnpm workspace, root scripts, Node policy, strict TypeScript base; clean install/build/test works.

### RF-M0-004 — Preserve RFC-001 and RFC-002

**Status:** NEXT  
**Acceptance:** Graph IR and Language RFCs live under `docs/rfc`; README links them.

### RF-M0-005 — Foundation CI

**Status:** NEXT  
**Acceptance:** clean checkout CI runs build/typecheck/test.

### RF-M0-006 — Shared test-support package

**Status:** NEXT  
**Acceptance:** deterministic IDs, fake clock, fixtures/helpers usable without package cycles.

---

# M1 — Reference Runtime

## Runtime contracts

### RF-M1-001 — Define GraphRun contract

**Status:** NEXT  
**Acceptance:** graph identity/version/hash, run state, timestamps, immutable input refs.

### RF-M1-002 — Define NodeRun contract

**Status:** NEXT  
**Depends:** RF-M1-001  
**Acceptance:** node ID, attempt, state, driver ref, outcome/error, timestamps.

### RF-M1-003 — Define runtime event envelope

**Status:** NEXT  
**Acceptance:** version, event ID, sequence, run ID, optional node/attempt, timestamp, typed payload.

### RF-M1-004 — Define runtime error taxonomy

**Status:** NEXT  
**Acceptance:** graph/runtime/policy/driver/interruption errors are typed; no string-only control branching.

### RF-M1-005 — Define node outcome contract

**Status:** NEXT  
**Acceptance:** runtime outcomes map exactly to Graph IR-declared outcomes.

## Reducers/state machine

### RF-M1-006 — GraphRun state reducer

**Status:** NEXT  
**Depends:** RF-M1-003  
**Acceptance:** deterministic transitions for start/pause/fail/complete/cancel; invalid transition rejected.

### RF-M1-007 — NodeRun state reducer

**Status:** NEXT  
**Acceptance:** deterministic node transition table and tests.

### RF-M1-008 — In-memory EventStore

**Status:** NEXT  
**Acceptance:** ordered append, monotonic sequence, read/replay by run.

### RF-M1-009 — Runtime projection builder

**Status:** NEXT  
**Depends:** RF-M1-006, RF-M1-007, RF-M1-008  
**Acceptance:** GraphRun/NodeRun state rebuilt entirely from events.

## Scheduler/routing

### RF-M1-010 — Initial entry scheduling

**Status:** NEXT  
**Acceptance:** only valid entry node becomes READY.

### RF-M1-011 — Deterministic edge selector

**Status:** NEXT  
**Acceptance:** pass/fail/declared outcome selects correct edge; unknown outcome returns typed error.

### RF-M1-012 — Ready-node scheduler

**Status:** NEXT  
**Acceptance:** dependencies respected; no premature node execution.

### RF-M1-013 — Terminal completion

**Status:** NEXT  
**Acceptance:** graph completes only after valid terminal transition.

### RF-M1-014 — Dead/block handling

**Status:** NEXT  
**Acceptance:** unsatisfied transition becomes typed blocked/failure state, never infinite wait.

## Bounded loops

### RF-M1-015 — Runtime LoopAttempt tracking

**Status:** NEXT  
**Acceptance:** attempts represented in events/projection.

### RF-M1-016 — Enforce maxAttempts

**Status:** NEXT  
**Acceptance:** retry after limit cannot start.

### RF-M1-017 — Loop exhaustion behavior

**Status:** NEXT  
**Acceptance:** fail/pause/escalate follows IR policy.

### RF-M1-018 — New-evidence retry hook

**Status:** NEXT  
**Acceptance:** loop configured for evidence cannot retry without evidence reference.

## Driver foundation

### RF-M1-019 — Draft AgentDriver interface

**Status:** NEXT  
**Acceptance:** runtime depends only on `driver-core` public types.

### RF-M1-020 — FakeAgentDriver

**Status:** NEXT  
**Acceptance:** scripted node outcomes per attempt; async event stream.

### RF-M1-021 — Fake driver failure scenarios

**Status:** NEXT  
**Acceptance:** timeout, provider failure, blocked, interrupted scenarios.

## Deterministic node execution

### RF-M1-022 — ActionRunner interface

**Status:** NEXT  
**Acceptance:** action/check execution is independent from agent driver.

### RF-M1-023 — FakeCheckRunner

**Status:** NEXT  
**Acceptance:** scripted pass/fail/timeout output.

### RF-M1-024 — Check result mapping

**Status:** NEXT  
**Acceptance:** check result deterministically maps to declared graph outcome.

## Human node

### RF-M1-025 — Human node enters awaiting approval

**Status:** NEXT  
**Acceptance:** scheduler pauses progression and emits approval-needed state/event.

### RF-M1-026 — Resolve Human outcome

**Status:** NEXT  
**Acceptance:** approve/reject resumes through declared edge.

## Engine/CLI

### RF-M1-027 — `runGraph()` orchestration

**Status:** NEXT  
**Depends:** M1 contracts, scheduler, loop, driver, checks, human node.  
**Acceptance:** reference graph executes deterministically end-to-end.

### RF-M1-028 — Runtime event observer API

**Status:** NEXT  
**Acceptance:** consumers subscribe without mutating runtime internals.

### RF-M1-029 — CLI `roflock run`

**Status:** NEXT  
**Acceptance:** source → compile → validate → execute.

### RF-M1-030 — CLI live/status output

**Status:** NEXT  
**Acceptance:** current node, attempt, state, selected edge visible.

### RF-M1-031 — Reference runtime integration test

**Status:** NEXT  
**Acceptance:** Builder → Tests fail → retry → Tests pass → Reviewer approve → Human → Done.

### RF-M1-032 — M1 runtime docs

**Status:** NEXT  
**Acceptance:** architecture and runnable fake-driver example documented.

---

# M2 — Durability, repository, control, approval, evidence

## Persistent events

### RF-M2-001 — SQLite database package

**Status:** PLANNED  
**Acceptance:** WAL, migrations, disposable test DB.

### RF-M2-002 — SQLite EventStore

**Status:** PLANNED  
**Acceptance:** durable ordered append/read/stream.

### RF-M2-003 — Materialized snapshots

**Status:** PLANNED  
**Acceptance:** snapshot + subsequent replay equals full replay state.

### RF-M2-004 — Boot recovery coordinator

**Status:** PLANNED  
**Acceptance:** incomplete runs discovered after daemon restart.

### RF-M2-005 — Stable idempotency keys

**Status:** PLANNED  
**Acceptance:** duplicate command application safe/rejected deterministically.

## Runtime leases

### RF-M2-006 — RuntimeLease contract

### RF-M2-007 — Lease heartbeat

### RF-M2-008 — Expired lease recovery

### RF-M2-009 — WriterLease contract

### RF-M2-010 — Enforce one writer

**Status:** PLANNED  
**Key acceptance:** concurrent writer start on same worktree is rejected.

## Repository runtime

### RF-M2-011 — Repository registration

### RF-M2-012 — Repository validation

### RF-M2-013 — Git worktree creation

### RF-M2-014 — Worktree lifecycle

### RF-M2-015 — Diff/status capture

### RF-M2-016 — Interrupted writer inspection

**Status:** PLANNED.

## Real command runner

### RF-M2-017 — Typed command execution

### RF-M2-018 — stdout/stderr artifact storage

### RF-M2-019 — timeout/signal handling

### RF-M2-020 — command permission hook

### RF-M2-021 — native test/check result

**Status:** PLANNED.

## Run control

### RF-M2-022 — Pause command

### RF-M2-023 — Resume command

### RF-M2-024 — Cooperative stop

### RF-M2-025 — Force terminate

### RF-M2-026 — Cancel task

### RF-M2-027 — Emergency stop

### RF-M2-028 — Process-tree reconciliation

**Status:** PLANNED.

## Typed confirmation/approval

### RF-M2-029 — ConfirmationRequest contract

### RF-M2-030 — Request fingerprinting

### RF-M2-031 — Approval decision persistence

### RF-M2-032 — Approval invalidation

### RF-M2-033 — Scoped reusable grants

### RF-M2-034 — Sensitive-action fresh approval rules

**Status:** PLANNED.

## Evidence

### RF-M2-035 — Artifact contract

### RF-M2-036 — Artifact hash/provenance

### RF-M2-037 — Test evidence

### RF-M2-038 — Diff/patch evidence

### RF-M2-039 — ReviewFinding contract

### RF-M2-040 — Human approval evidence

### RF-M2-041 — Evidence bundle exporter

**Status:** PLANNED.

## M2 vertical slice

### RF-M2-042 — Forced daemon restart fixture

### RF-M2-043 — Recovery does not duplicate invocation

### RF-M2-044 — Durable BugFix end-to-end test

**Status:** PLANNED.

---

# M3 — Stable Driver API

### RF-M3-001 — Driver capability schema

### RF-M3-002 — Driver availability/auth status

### RF-M3-003 — AgentRunRequest

### RF-M3-004 — AgentEvent schema

### RF-M3-005 — Cancellation capability contract

### RF-M3-006 — Session resume contract

### RF-M3-007 — Usage event contract

### RF-M3-008 — Structured output contract

### RF-M3-009 — Driver conformance test kit

### RF-M3-010 — Fake driver conformance

### RF-M3-011 — RFC: Driver API v1

### RF-M3-012 — Driver authoring docs

**Status:** PLANNED.

---

# M4 — Codex driver and real BugFix

### RF-M4-001 — Detect installed Codex

### RF-M4-002 — Codex auth/health check

### RF-M4-003 — Non-interactive simple invocation

### RF-M4-004 — Readonly mode

### RF-M4-005 — Workspace-write mode

### RF-M4-006 — Structured event mapping

### RF-M4-007 — Tool/command event mapping

### RF-M4-008 — Session/thread identity persistence

### RF-M4-009 — Resume where supported

### RF-M4-010 — Cancellation truthfulness

### RF-M4-011 — Usage/cost capture

### RF-M4-012 — Unknown outcome reconciliation

### RF-M4-013 — Codex conformance suite

### RF-M4-014 — Sample buggy repository

### RF-M4-015 — Regression test before fix

### RF-M4-016 — Real Codex Builder node

### RF-M4-017 — Independent readonly reviewer

### RF-M4-018 — Human final approval

### RF-M4-019 — Full evidence bundle

### RF-M4-020 — Real BugFix E2E

**Status:** PLANNED.

---

# M5 — Multi-driver coding

### RF-M5-001 — Claude Code detection/auth

### RF-M5-002 — Claude Code driver core

### RF-M5-003 — Claude event/cancellation mapping

### RF-M5-004 — Claude conformance

### RF-M5-005 — OpenCode driver

### RF-M5-006 — OpenCode conformance

### RF-M5-007 — OpenAI-compatible driver

### RF-M5-008 — Anthropic-compatible driver

### RF-M5-009 — Custom HTTP driver

### RF-M5-010 — Local model endpoint support

### RF-M5-011 — Role capability resolver

### RF-M5-012 — Execution profiles

### RF-M5-013 — Provider fallback policy

### RF-M5-014 — Provider disclosure manifest

### RF-M5-015 — Context Compiler v1

### RF-M5-016 — Context inspector API

### RF-M5-017 — Usage ledger

### RF-M5-018 — Budget policy

### RF-M5-019 — Quota snapshot interface

### RF-M5-020 — Same workflow / two profiles E2E

**Status:** PLANNED.

---

# M6 — Studio

### RF-M6-001 — Local daemon shell

### RF-M6-002 — Local auth token

### RF-M6-003 — Shared API contracts

### RF-M6-004 — SSE event endpoint

### RF-M6-005 — Vite/React Studio shell

### RF-M6-006 — Project/repository screen

### RF-M6-007 — Workflow list

### RF-M6-008 — Code editor

### RF-M6-009 — Language diagnostics integration

### RF-M6-010 — Readonly graph rendering

### RF-M6-011 — Graph live state

### RF-M6-012 — Run timeline

### RF-M6-013 — Active execution panel

### RF-M6-014 — Terminal/log panel

### RF-M6-015 — Evidence panel

### RF-M6-016 — Diff viewer

### RF-M6-017 — Approval Inbox

### RF-M6-018 — Driver settings

### RF-M6-019 — Profile settings

### RF-M6-020 — Cost/usage view

### RF-M6-021 — Pause/stop/cancel UI

### RF-M6-022 — Reconnect/restart state

### RF-M6-023 — Accessibility pass

### RF-M6-024 — Studio BugFix E2E

**Status:** PLANNED.

---

# M7 — Self-hosted team/control plane

### RF-M7-001 — Workspace/user contracts

### RF-M7-002 — Postgres EventStore

### RF-M7-003 — Multi-user auth

### RF-M7-004 — RBAC

### RF-M7-005 — Organization policy hierarchy

### RF-M7-006 — Shared workflow storage

### RF-M7-007 — Shared approval routing

### RF-M7-008 — Central audit log

### RF-M7-009 — Artifact/object storage adapter

### RF-M7-010 — Runner protocol

### RF-M7-011 — Self-hosted runner

### RF-M7-012 — Runner registration/heartbeat

### RF-M7-013 — Provider administration

### RF-M7-014 — SSO integration interface

### RF-M7-015 — Backup/export

### RF-M7-016 — Self-host Docker Compose

### RF-M7-017 — No-Cloud self-host E2E

**Status:** PLANNED.

---

# M8 — Registry and extensions

### RF-M8-001 — Package manifest RFC

### RF-M8-002 — Package permission manifest

### RF-M8-003 — Registry client

### RF-M8-004 — Self-host registry server

### RF-M8-005 — Publish command

### RF-M8-006 — Install command

### RF-M8-007 — Version resolution

### RF-M8-008 — Package integrity hashes

### RF-M8-009 — Trust/signing groundwork

### RF-M8-010 — Driver package SDK

### RF-M8-011 — Check/action extension SDK

### RF-M8-012 — Policy extension SDK

### RF-M8-013 — Domain-pack SDK

### RF-M8-014 — Public sample package

### RF-M8-015 — Untrusted-package security tests

**Status:** PLANNED.

---

# M9 — v1 hardening

### RF-M9-001 — Language v1 compatibility suite

### RF-M9-002 — Graph IR migration suite

### RF-M9-003 — Driver API compatibility suite

### RF-M9-004 — Parser fuzz/property tests

### RF-M9-005 — Graph validator adversarial corpus

### RF-M9-006 — Runtime crash/fault suite

### RF-M9-007 — Security threat-model test matrix

### RF-M9-008 — macOS CI

### RF-M9-009 — Linux CI

### RF-M9-010 — Windows CI

### RF-M9-011 — CLI packaging

### RF-M9-012 — Studio packaging

### RF-M9-013 — Full documentation pass

### RF-M9-014 — Upgrade/migration test

### RF-M9-015 — OSS self-host acceptance

### RF-M9-016 — License/trademark legal review

### RF-M9-017 — Release candidate

### RF-M9-018 — Stable v1 release

**Status:** PLANNED.

---

# Deferred expansion backlog

Not authorized before coding-first v1 unless an RFC explicitly changes priority:

- manufacturing/general industry domain packs;
- generic business automation;
- mobile Studio client;
- full cognitive memory system;
- graph database;
- autonomous production deployment;
- unbounded swarm mode;
- general-purpose workflow programming constructs.

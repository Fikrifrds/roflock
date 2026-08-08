# Roflock Migration Backlog v1.0

**Goal:** Atomic execution order for evolving the existing repository.

The coding harness must re-evaluate ticket dependencies after the baseline audit, but may not collapse the migration into a rewrite.

---

# R0 — Audit and guardrails

### RF-EVO-001 — Capture repository baseline
Run root build/lint/typecheck/test/format checks and store results.

### RF-EVO-002 — Create migration audit
Inventory packages, apps, tests, data contracts, graph versions, env/config, CLI, database.

### RF-EVO-003 — Classify current packages
Mark KEEP/ADAPT/GENERALIZE/REPLACE/RETIRE with rationale.

### RF-EVO-004 — Freeze graph-runtime semantic regression suite
Add/confirm tests for scheduling, retries, writer serialization, failure routes, artifact gates.

### RF-EVO-005 — Freeze persisted compatibility inventory
Document DB schema, environment variables, data directory, config filenames, graph-version IDs.

### RF-EVO-006 — Install PRD/implementation docs into repo
Add current Roflock development docs without removing historical docs.

**R0 exit:** baseline is measurable; no ambiguity about what is being preserved.

---

# R1 — Safe Roflock rebrand

### RF-EVO-010 — Rebrand README/product description
Roflock positioning only; no runtime semantic change.

### RF-EVO-011 — Add `roflock` CLI binary
Keep compatibility alias if needed.

### RF-EVO-012 — Add `ROFLOCK_*` environment names
Legacy `ROLEFLOCK_*` fallback.

### RF-EVO-013 — Data directory migration strategy
Support existing `~/.roleflock` safely.

### RF-EVO-014 — Config filename compatibility
Prefer `roflock.config.*`; accept legacy config during transition.

### RF-EVO-015 — Package namespace audit
Determine whether `@roleflock/*` has external consumers before rename.

### RF-EVO-016 — OSS governance/license completeness
License, security, contribution, charter/boundary docs.

**R1 exit:** fresh user sees Roflock; old local data/config still works.

---

# R2 — Language + Graph IR integration

### RF-EVO-020 — Add `packages/graph-ir`
Integrate reference Graph IR foundation.

### RF-EVO-021 — Graph IR tests
Normalization, hash, semantic diagnostics.

### RF-EVO-022 — Add `packages/language`
Tokenizer/parser/AST/compiler.

### RF-EVO-023 — Language tests
Valid/invalid fixtures.

### RF-EVO-024 — Add example `.roflock`
At least linear and BugFix examples.

### RF-EVO-025 — CLI `roflock check`
Compile + validate source.

### RF-EVO-026 — CLI `roflock compile`
Emit canonical Graph IR.

### RF-EVO-027 — CLI IR utilities
validate/normalize/hash as needed.

### RF-EVO-028 — Root verification integration
New packages join build/lint/typecheck/test.

**R2 exit:** language foundation lives in the actual repo and passes all old + new tests.

---

# R3 — Graph IR compatibility bridge

### RF-EVO-030 — Define runtime graph adapter contract
Explicit boundary Graph IR → current runtime graph.

### RF-EVO-031 — Map linear nodes/edges
No loops/providers yet.

### RF-EVO-032 — Map node kinds
agent/check/action/human compatibility.

### RF-EVO-033 — Map structured outcomes/failure conditions
Preserve current typed routing.

### RF-EVO-034 — Map writer semantics
Graph IR effect/permission → existing writer behavior.

### RF-EVO-035 — Map required checks
Cannot bypass deterministic verification.

### RF-EVO-036 — Map bounded loops
IR LoopGroup → existing retry/loop ceiling where equivalent.

### RF-EVO-037 — Map human approval
Pause/approval path via existing approval infrastructure.

### RF-EVO-038 — Map role/artifact gate
Use existing role-protocol compatibility.

### RF-EVO-039 — Fake executor integration test
Compiled `.roflock` executes through existing runtime.

### RF-EVO-040 — Fail/retry/pass E2E
Reference deterministic workflow.

**R3 exit:** executable `.roflock` exists without a second runtime.

---

# R4 — Built-in workflow source migration

### RF-EVO-050 — Legacy graph semantic snapshot fixtures

### RF-EVO-051 — Direct workflow `.roflock`

### RF-EVO-052 — Direct semantic-equivalence test

### RF-EVO-053 — Fast workflow `.roflock`

### RF-EVO-054 — Fast semantic-equivalence test

### RF-EVO-055 — Bug Fix workflow `.roflock`

### RF-EVO-056 — Bug Fix semantic-equivalence test

### RF-EVO-057 — Standard workflow `.roflock`

### RF-EVO-058 — Standard semantic-equivalence test

### RF-EVO-059 — Critical workflow `.roflock`

### RF-EVO-060 — Critical semantic-equivalence test

### RF-EVO-061 — New-task workflow loader uses compiled templates

### RF-EVO-062 — Preserve historical graph resolver
Existing pinned graph runs remain supported.

**R4 exit:** hard-coded workflows are compatibility/history; new source of truth is `.roflock`.

---

# R5 — Durable runtime extraction

### RF-EVO-070 — Runtime event envelope

### RF-EVO-071 — GraphRun contract

### RF-EVO-072 — NodeRun contract

### RF-EVO-073 — LoopAttempt contract

### RF-EVO-074 — Emit events around current `runGraph`

### RF-EVO-075 — Deterministic reducers

### RF-EVO-076 — EventStore interface

### RF-EVO-077 — SQLite EventStore

### RF-EVO-078 — Runtime projection

### RF-EVO-079 — Snapshot support

### RF-EVO-080 — Stable invocation/idempotency key

### RF-EVO-081 — Explicit OUTCOME_UNKNOWN

### RF-EVO-082 — Boot reconciliation

### RF-EVO-083 — Process reconciliation with existing PID tracking

### RF-EVO-084 — Writer lease reconciliation

### RF-EVO-085 — Forced restart E2E

### RF-EVO-086 — No blind duplicate billable invocation test

**R5 exit:** compiled workflow survives daemon restart with truthful state.

---

# R6 — Generic roles and artifacts

### RF-EVO-090 — Introduce generic RoleId boundary

### RF-EVO-091 — RoleDefinition schema

### RF-EVO-092 — Legacy role adapter

### RF-EVO-093 — Preserve ROLE_AUTHORITY_MATRIX as coding profile

### RF-EVO-094 — Artifact type registry/definition

### RF-EVO-095 — Typed input/output ports

### RF-EVO-096 — Artifact compatibility validation

### RF-EVO-097 — Producer/consumer static diagnostics

### RF-EVO-098 — Retry requires new evidence policy

### RF-EVO-099 — Custom role integration fixture

**R6 exit:** non-built-in role names work without weakening existing coding authority.

---

# R7 — AgentDriver evolution

### RF-EVO-110 — Draft AgentDriver contract

### RF-EVO-111 — DriverCapabilities

### RF-EVO-112 — AgentRunRequest

### RF-EVO-113 — AgentEvent convergence

### RF-EVO-114 — Fake driver conformance kit

### RF-EVO-115 — ProviderAdapter compatibility wrapper

### RF-EVO-116 — Codex driver migration

### RF-EVO-117 — Codex conformance

### RF-EVO-118 — Claude driver migration

### RF-EVO-119 — Claude conformance

### RF-EVO-120 — OpenCode driver

### RF-EVO-121 — Generic compatible/custom driver

### RF-EVO-122 — Driver cancellation capability truthfulness

### RF-EVO-123 — Driver session/resume capability

### RF-EVO-124 — Usage events

**R7 exit:** graph/runtime depends on driver contract, not provider-specific implementation.

---

# R8 — Evidence and coding semantics

### RF-EVO-130 — General Artifact provenance model

### RF-EVO-131 — Map existing evidence records

### RF-EVO-132 — Map Change Contract to Outcome Contract/coding semantics

### RF-EVO-133 — Preserve Execution Plan semantics

### RF-EVO-134 — Preserve Verification Specification

### RF-EVO-135 — ReviewFinding artifact

### RF-EVO-136 — Human approval artifact

### RF-EVO-137 — Evidence bundle manifest

### RF-EVO-138 — Change Passport compatibility/export

### RF-EVO-139 — `roflock evidence`

### RF-EVO-140 — `roflock why --file`

**R8 exit:** a run is explainable from stored evidence/provenance.

---

# R9 — Browser Playground

### RF-EVO-150 — Make language/compiler browser-safe

### RF-EVO-151 — Shared graph rendering model

### RF-EVO-152 — Playground shell

### RF-EVO-153 — Code editor

### RF-EVO-154 — live compile/diagnostics

### RF-EVO-155 — graph render

### RF-EVO-156 — examples

### RF-EVO-157 — fake simulation

### RF-EVO-158 — share serialization

### RF-EVO-159 — docs `Open in Playground`

**R9 exit:** Mermaid-like code → graph → diagnostics → simulation works on web without runtime access.

---

# R10 — Studio evolution

### RF-EVO-170 — Shared editor/graph UI packages

### RF-EVO-171 — Code view

### RF-EVO-172 — Diagram view

### RF-EVO-173 — Run/event view

### RF-EVO-174 — Evidence view

### RF-EVO-175 — Approval Inbox integration

### RF-EVO-176 — Active driver/model/permission display

### RF-EVO-177 — pause/stop/cancel truthfulness

### RF-EVO-178 — reconnect/recovery UI

### RF-EVO-179 — author → run real BugFix E2E

**R10 exit:** Code + Diagram + Run + Evidence is the flagship local product experience.

---

# Later / not part of migration critical path

- registry and package publishing;
- self-hosted team control plane expansion;
- RBAC/SSO expansion;
- remote runner fleet;
- non-coding domain packs;
- distributed scheduler;
- managed cloud.

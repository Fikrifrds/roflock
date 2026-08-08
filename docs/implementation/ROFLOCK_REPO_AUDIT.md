# Roflock Repository Audit

**Status:** R0 baseline frozen; R1 outcome recorded in [§12](#12-r1-outcome--roflock-rebrand)
**Tickets:** RF-EVO-001, RF-EVO-002, RF-EVO-003, RF-EVO-005 (+ R1 summary)
**Baseline commit:** `d5bcacb742c56af17cc2ed9cf79c7fbf94e45291`
**Date:** 8 August 2026

Sections 1–11 describe the repository **as frozen at the baseline commit** and are
not rewritten as work lands — a baseline that drifts is not a baseline. Later
phases append a section and, where a specific statement has since become wrong,
add a marked amendment in place. Sections 1.1 and 2 carry such amendments.

This document answers the R0 exit question:

> What are we preserving, what are we changing, and why?

It is the mandatory prerequisite for structural migration. Every claim below was
verified against the local checkout, not copied from the handoff planning docs.
Where the planning docs and the code disagree, the code wins and the discrepancy
is recorded in [§9](#9-discrepancies-between-planning-docs-and-code).

---

## 1. Verification baseline (RF-EVO-001)

Run at `d5bcacb` with pnpm 11.17.0 / Node ≥ 24 on darwin.

| Command                          | Exit  | Result                                     |
| -------------------------------- | ----- | ------------------------------------------ |
| `pnpm install --frozen-lockfile` | 0     | lockfile satisfies the workspace           |
| `pnpm build`                     | 0     | all 26 packages + 3 apps compile           |
| `pnpm lint`                      | 0     | clean                                      |
| `pnpm typecheck`                 | 0     | clean                                      |
| `pnpm test`                      | 0     | **115 test files, 432 tests, all passing** |
| `pnpm format:check`              | **1** | **68 files unformatted — pre-existing**    |

### 1.1 Known baseline failure: `format:check`

`pnpm format:check` fails at baseline. This is **not** caused by migration work and
must not be attributed to it later. Of the 68 files Prettier flags, 61 are tracked
repository files and 7 belong to the untracked `roflock-ai-coding-handoff-v1.0/`
drop directory.

The unformatted tracked files span `docs/adr/*` (17 files), `docs/product/*`,
`docs/{public,security,test-plans}/*`, 12 files under
`packages/database/src/repositories/`, several provider packages,
`apps/daemon/src/services/{export-service,pricing,review-app}.ts`, four
`apps/web` files, `pnpm-workspace.yaml`, `roleflock.config.example.yaml`, and
`scripts/benchmark-verified-fix.mjs`.

**Rule for the migration:** a bulk `pnpm format` is a legitimate standalone commit,
but it MUST NOT be folded into a ticket that changes behaviour — the master
instruction forbids mixing formatting with semantic commits. Until that cleanup
lands, every milestone check compares the _set_ of flagged files against this
baseline list rather than asserting exit code 0.

> **Amended after R1.** The set is now 66 tracked files, not 68.
> `roleflock.config.example.yaml` left it by being renamed and rewritten
> (RF-EVO-014) and `apps/daemon/src/services/export-service.ts` by being
> reformatted as part of RF-EVO-013. Nothing was newly added. Compare against
> the current set, and treat any addition as a regression.

### 1.2 Working tree state at baseline

`apps/web/src/lib/client.ts` carries an uncommitted change (gating `useData`'s
`isLoading` on `isFetched` so background refetches stop remounting editors). It is
pre-existing user work, unrelated to this migration, and was deliberately left
untouched and uncommitted. Migration commits must stage files explicitly so this
change is never swept into a ticket commit.

### 1.3 Test distribution

| Area                           | Test files | Tests |
| ------------------------------ | ---------- | ----- |
| `apps/daemon`                  | 31         | 125   |
| `apps/web`                     | 10         | 63    |
| `packages/database`            | 21         | 37    |
| `packages/change-contracts`    | 7          | 33    |
| `packages/role-recommender`    | 9          | 27    |
| `packages/graph-runtime`       | 1          | 18    |
| `packages/verification-runner` | 6          | 16    |
| `packages/agent-events`        | 6          | 15    |
| `packages/provider-cursor`     | 1          | 15    |
| `packages/graph-core`          | 1          | 11    |
| `packages/role-protocol`       | 2          | 11    |
| everything else                | 20         | 61    |

The two packages most exposed to migration risk — `graph-core` and
`graph-runtime` — have 29 tests between them in just two files. Coverage is
semantically dense but structurally concentrated; see [§7](#7-runtime-regression-suite-rf-evo-004).

---

## 2. Repository shape

```text
apps/
  cli       @roleflock/cli      272 LOC   bin: roleflock
  daemon    @roleflock/daemon  11564 LOC  Fastify API + orchestrator
  web       @roleflock/web      9308 LOC  React Studio precursor
packages/   26 packages, ~28800 LOC
fixtures/   scripts/   docs/
```

Every workspace package is `"private": true` and none is published. `@roleflock/*`
has **no external consumers**, which resolves RF-EVO-015 in advance: the namespace
rename is a pure internal refactor with zero compatibility obligation. It is
therefore _safe_ but still _churny_, so it stays sequenced after runtime
integration per the implementation plan.

> **Amended after R1.** The CLI Distribution plan makes the CLI a permanent
> product surface published to npm as `roflock` or `@roflock/cli`. That does not
> create a backwards-compatibility obligation — there is still nothing to break —
> but it does give the rename a **deadline**: the published package must not
> carry the old namespace, so RF-EVO-015 has to land before the first publish
> (RF-DIST-012). The executable name is the user-facing contract and was
> decoupled from the package name in R1, so the two can be sequenced separately.

Only two `bin` entries exist: root `package.json` and `apps/cli/package.json`,
both mapping the name `roleflock` to `./apps/cli/dist/cli.js`. The CLI today does
exactly one thing — `runPassportCli` — so adding `roflock` plus language commands
is additive, not a rewrite.

---

## 3. Package inventory and classification (RF-EVO-002 / RF-EVO-003)

`P/I` = public surface intent: **I**nternal-only today (all of them are, since
nothing is published), **C** = carries a _persisted_ contract that outlives the
process and therefore behaves like a public contract regardless of package
privacy.

| Package               | LOC   | Tests | Deps (internal)                                                                                                  | P/I | Class                  | Target role                                              | Migration risk                               |
| --------------------- | ----- | ----- | ---------------------------------------------------------------------------------------------------------------- | --- | ---------------------- | -------------------------------------------------------- | -------------------------------------------- |
| `contracts`           | 422   | 5     | —                                                                                                                | C   | **KEEP + EVOLVE**      | shared runtime/API contracts; `EventEnvelope` lives here | Medium — event envelope is persisted         |
| `role-protocol`       | 726   | 11    | —                                                                                                                | C   | **GENERALIZE**         | coding authority profile + generic `RoleId` bridge       | High — enforcement must not weaken           |
| `graph-core`          | 891   | 11    | contracts, role-protocol                                                                                         | C   | **ADAPT + GENERALIZE** | legacy graph compatibility + template source             | High — pinned graph versions                 |
| `graph-runtime`       | 842   | 18    | contracts, graph-core, database, role-protocol                                                                   | C   | **KEEP + HARDEN**      | the one canonical runtime                                | Critical — no second runtime                 |
| `database`            | 10065 | 37    | agent-events, change-passport, change-contracts, contracts, role-recommender, role-protocol, verification-runner | C   | **KEEP + MIGRATE**     | local durable store; 33 migrations, 43 tables            | Critical — user data                         |
| `agent-events`        | 1699  | 15    | contracts                                                                                                        | C   | **KEEP + CONVERGE**    | driver/runtime agent event model                         | Medium — avoid duplicate taxonomies          |
| `approval-engine`     | 251   | 3     | contracts                                                                                                        | I   | **KEEP**               | typed human authority → generic `human` nodes            | Low                                          |
| `policy-engine`       | 161   | 1     | contracts                                                                                                        | I   | **KEEP**               | permissions/effects/budgets                              | Low                                          |
| `repository-runtime`  | 550   | 8     | contracts, database                                                                                              | I   | **KEEP**               | Git/worktree/diff/leases; one-writer                     | Medium                                       |
| `command-runner`      | 270   | 6     | contracts                                                                                                        | I   | **KEEP**               | deterministic action execution                           | Low                                          |
| `verification-runner` | 2659  | 16    | change-contracts, command-runner, contracts                                                                      | I   | **KEEP + ADAPT**       | native runner behind IR `check`                          | Medium                                       |
| `context-compiler`    | 440   | 6     | contracts                                                                                                        | I   | **KEEP**               | invocation context builder                               | Low                                          |
| `evidence`            | 8     | 0     | contracts, database                                                                                              | I   | **KEEP + GENERALIZE**  | artifacts/provenance                                     | Low — see §9.3                               |
| `change-contracts`    | 2890  | 33    | contracts                                                                                                        | C   | **KEEP + GENERALIZE**  | coding Outcome Contract profile                          | Medium                                       |
| `change-passport`     | 1444  | 10    | contracts, secret-store                                                                                          | C   | **KEEP + GENERALIZE**  | portable evidence bundle                                 | High — users may hold exports                |
| `role-recommender`    | 3561  | 27    | contracts, provider-core, role-protocol                                                                          | I   | **KEEP → coding pack** | recommendation, not IR semantics                         | Low                                          |
| `provider-core`       | 400   | 5     | contracts                                                                                                        | I   | **ADAPT**              | → `driver-core`                                          | High — process lifecycle                     |
| `provider-codex`      | 225   | 2     | contracts, provider-core                                                                                         | I   | **ADAPT**              | Codex AgentDriver                                        | Medium                                       |
| `provider-claude`     | 202   | 1     | contracts, provider-core                                                                                         | I   | **ADAPT**              | Claude AgentDriver                                       | Medium                                       |
| `provider-cursor`     | 769   | 15    | contracts, provider-core                                                                                         | I   | **ADAPT / later**      | Cursor driver if capabilities stay truthful              | Medium                                       |
| `provider-custom`     | 164   | 1     | contracts, provider-core                                                                                         | I   | **ADAPT**              | generic HTTP/BYOK driver                                 | Low                                          |
| `usage-ledger`        | 232   | 3     | contracts, database                                                                                              | C   | **KEEP**               | cost/usage; actual vs estimated                          | Low                                          |
| `run-control`         | 95    | 1     | contracts, database                                                                                              | I   | **KEEP + HARDEN**      | pause/stop/cancel truthfulness                           | Medium                                       |
| `observability`       | 404   | 6     | contracts                                                                                                        | I   | **KEEP**               | logs/traces; unknown stays unknown                       | Low                                          |
| `secret-store`        | 16    | 0     | contracts                                                                                                        | I   | **KEEP**               | secret abstraction                                       | Low                                          |
| `test-support`        | 15    | 0     | contracts                                                                                                        | I   | **EXPAND**             | fake driver, test repo, fault injection                  | Low — currently a stub                       |
| `apps/cli`            | 272   | 3     | change-passport                                                                                                  | C   | **EXPAND**             | `roflock` CLI + language commands                        | Low                                          |
| `apps/daemon`         | 11564 | 125   | 23 internal packages                                                                                             | C   | **KEEP + EVOLVE**      | local runtime/API host                                   | High — orchestrator is the integration point |
| `apps/web`            | 9308  | 63    | — (HTTP only)                                                                                                    | I   | **EVOLVE**             | Roflock Studio                                           | Medium — keep operations working             |

### 3.1 New packages to ADD

| Package               | Purpose                                                                          | Must not                   |
| --------------------- | -------------------------------------------------------------------------------- | -------------------------- |
| `graph-ir`            | canonical IR types, JSON Schema, normalization, semantic hash, IR-level checks   | hold mutable runtime state |
| `language`            | tokenizer, parser, AST/CST, compiler passes, diagnostics, formatter, source maps | execute graph nodes        |
| `graph-ui` (later)    | browser-safe renderer shared by Playground, Studio, docs                         | own a private graph model  |
| `driver-core` (later) | evolved from `provider-core`                                                     | be duplicated prematurely  |

RFC-001 §30 proposes splitting the language into `language-core` /
`language-parser` / `language-compiler` / `language-formatter`. The
implementation plan (Stream B) prefers a single `language` package until a split
is justified. **Decision for R2: start with `graph-ir` + `language`.** Fragmenting
five packages before the vertical slice is green adds wiring cost without buying
a boundary anyone needs yet. Revisit when the LSP arrives, which is the first
consumer that genuinely needs parser-without-compiler.

---

## 4. Dependency direction

Current internal edges, as read from `package.json` files:

```text
contracts ── nothing          (correct root)
role-protocol ── nothing      (correct root)
graph-core ──► contracts, role-protocol
graph-runtime ──► contracts, graph-core, database, role-protocol
database ──► agent-events, change-passport, change-contracts, contracts,
             role-recommender, role-protocol, verification-runner
daemon ──► 23 packages
```

Two things stand out.

**4.1 `graph-runtime → database` is a real edge.** The target direction in the
handoff mapping places persistence _below_ the runtime, so this is directionally
acceptable, but it means the runtime package is not importable in a browser and
cannot be reused by the Playground. When Stream H needs graph semantics in the
browser it must consume `graph-ir`, never `graph-runtime`. Record as a constraint,
not a defect.

**4.2 `database` depends upward on seven domain packages.** `database` importing
`role-recommender` and `verification-runner` inverts the intended layering — the
store knows about domain logic rather than the other way round. This is the single
largest obstacle to extracting a clean `EventStore` interface in R5. It does not
need fixing in R0, but R5 should not begin until an ADR decides whether the
repositories move out of `database` or the domain types move into `contracts`.

**Forbidden edges to enforce in review** (none currently exist — keep it that way):

```text
graph-ir → Studio        NO      language → daemon    NO
graph-ir → any provider  NO      runtime → parser/AST NO
driver-core → Studio     NO
```

---

## 5. Persisted compatibility inventory (RF-EVO-005)

This is the surface where a careless rebrand destroys a user's installation.

### 5.1 Data directory and files

| Item           | Current value                          | Resolved in                                      |
| -------------- | -------------------------------------- | ------------------------------------------------ |
| Data dir       | `ROLEFLOCK_DATA_DIR` ?? `~/.roleflock` | `apps/daemon/src/server.ts:60`                   |
| Database       | `<dataDir>/roleflock.db`               | `apps/daemon/src/server.ts:84`                   |
| SQLite WAL     | `roleflock.db-wal`, `roleflock.db-shm` | `apps/daemon/src/services/export-service.ts:133` |
| Backup/export  | copies all three by literal filename   | `export-service.ts:128–148`                      |
| Session cookie | `roleflock_token`                      | `apps/daemon/src/auth.ts:107`                    |

`export-service.ts` hard-codes the filenames in **three** separate places
(existence probe, copy loop, manifest list). Any data-path rename must update all
three or backups silently omit the database. This is the highest-severity
rebrand trap in the repository.

### 5.2 Environment variables

27 `ROLEFLOCK_*` names are live in code, docs, or tests:

```text
ROLEFLOCK_DATA_DIR   ROLEFLOCK_HOME       ROLEFLOCK_PORT      ROLEFLOCK_VERSION
ROLEFLOCK_UPDATE_URL ROLEFLOCK_TASK_ID    ROLEFLOCK_SIMULATION
ROLEFLOCK_FORCE_FAKE ROLEFLOCK_INCLUDE_FAKE
ROLEFLOCK_WRITER_SECRET  ROLEFLOCK_COMMAND_RUNNER_SECRET  ROLEFLOCK_ROTATE_TOKEN
ROLEFLOCK_CURSOR_AGENT
ROLEFLOCK_PROVIDER_TIMEOUT_MS  ROLEFLOCK_PROVIDER_IDLE_TIMEOUT_MS
ROLEFLOCK_VERIFICATION  ROLEFLOCK_VERIFICATION_TIMEOUT_MS
ROLEFLOCK_CHECK_CURRENT ROLEFLOCK_CHECK_FAILED ROLEFLOCK_CHECK_MISSING
ROLEFLOCK_FIX  ROLEFLOCK_CONTRACT_HASH  ROLEFLOCK_PLAN_HASH  ROLEFLOCK_HANDOFF_HASH
ROLEFLOCK_PASSPORT_MISSING  ROLEFLOCK_PASSPORT_REVOKED
```

Required transition shape (R1 / RF-EVO-012):

```text
ROFLOCK_*     preferred
ROLEFLOCK_*   legacy fallback + one deprecation notice, never a hard break
```

These are not equivalent in risk. `ROLEFLOCK_WRITER_SECRET` and
`ROLEFLOCK_COMMAND_RUNNER_SECRET` are **security boundaries** passed to
subprocesses; a fallback that reads either name must not accidentally accept an
empty new-name value and fall through to a stale legacy one.

### 5.3 Config file

`roleflock.config.example.yaml` documents `~/.roleflock/config.yaml` and project
`.roleflock/config.yaml`. Grep finds **no loader that actually reads it** — the
example is currently aspirational. That makes RF-EVO-014 cheap: define
`roflock.config.yaml` as primary with legacy acceptance _when the loader is
written_, rather than migrating a live format.

### 5.4 Database schema

33 migrations, 43 tables. Tables that constitute persisted semantic contracts:

```text
events (aggregate_id, sequence, event_type, payload_json, metadata_json)
  + UNIQUE(aggregate_id, sequence)
  + partial unique index on metadata_json.$.idempotencyKey
graph_versions  workflow_graphs  workflow_nodes  workflow_edges
graph_runs      node_runs        loop_attempts   state_snapshots
invocations     process_handles  runtime_leases  control_commands
approvals       approval_grants  approval_groups confirmation_requests
change_contracts change_contract_versions  artefacts  review_findings
test_runs       usage_ledger_entries       audit_events
```

`tasks.workflow_graph_version_id` and the `graph_version_id` columns on
`graph_runs` / `workflow_nodes` / `workflow_edges` pin a run to its graph shape.
**Persisted event type strings and graph version ids may not be renamed** by the
rebrand — they are read back from historical rows.

### 5.5 Graph version identity

`GRAPH_SCHEMA_VERSION = 3`. `getWorkflowGraph()` resolves three generations —
`@1` (legacy), `@2` (pre planner-owned routing), `@3` (current) — and _rejects_
any other version rather than silently upgrading it. Pinned ids in user data:

```text
direct@{1,2,3}  fast@{1,2,3}  standard@{1,2,3}  bug_fix@{1,2,3}  critical@{1,2,3}
```

All 15 must remain resolvable through R4. Note that `@1` and `@2` also carry
_different validation rules_: `validateGraph` gates the `repair_envelope` guard
requirement and the verifier→planner routing rule on `graphVersion >= 3`, so
version is not merely a shape selector — it selects a validation profile. Any IR
bridge must preserve that, or old graphs will fail validation they previously
passed.

### 5.6 Other identifiers

- Change Passport media types: `application/vnd.roleflock.change-passport+json;version=1`
  and `...change-passport-revocation+json;version=1` — users may hold exported
  passports carrying these strings. Treat as frozen; add new types rather than
  renaming.
- `github_integrations.roleflock_actor_id` column and `roleflockActorId` API field.

---

## 6. Graph semantics inventory

### 6.1 Current model (`graph-core`)

```text
GraphMode      direct | fast | standard | bug_fix | critical
WorkflowRole   planner | reviewer | writer | test | verifier | accept
NodeKind       agent | model_call | command | test | router | join |
               human_approval | context_compile | evidence_aggregate
EdgeCondition  always | on_pass | on_fail | on_needs_changes |
               on_timeout | on_provider_error | on_budget_exhausted
```

Node carries `required`, `writer`, `maxAttempts`, `focus`, `authorityRole`.
Graph carries `maxConcurrency`, `maxLoopIterations`, `version`.

`validateGraph` enforces 15 distinct rules: node/edge reference integrity, no
duplicate ids, ≥1 and ≤1 writer, terminal accept node exists, finite retry
budgets, no self-dependency, authority-role/lease coherence, guarded repair edges
(v3+), no unconditional cycle, no cycle without a retry budget, required checks
dominate accept, failure never routes to accept, verifier findings route to
planner (v3+), `on_needs_changes` targets a writer, verifier never routes straight
to executor, and accept reachable from the writer.

### 6.2 Current runtime (`graph-runtime`)

`runGraph()` — 235 lines — validates before executing, schedules by dependency
readiness under `maxConcurrency`, serialises writers _independently of_ that cap,
gates node start and completion through `role-protocol` artifact assertions,
spends `maxAttempts` locally, then routes one typed failure edge chosen by
`FailureClass → EdgeCondition` preference order, resets the target and all its
descendants on loop re-entry, caps total re-entries at `maxLoopIterations`, lets
in-flight siblings settle honestly on failure, and supports `resumeCompleted` for
restart recovery.

`FailureClass` deserves specific preservation attention:

```text
verification_failed  needs_changes  timeout  provider_error
budget_exhausted     setup_required cancelled  unknown
```

`setup_required` and `cancelled` map to **no** edges by design — missing operator
configuration must stop at the gate rather than send unchanged code back through
the writer. That is a deliberate safety property that a naive
"map every outcome to an edge" IR bridge would erase.

### 6.3 Semantic mapping to Graph IR

| Current                       | IR v1                                            | Migration note                              |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------- |
| `WorkflowGraph`               | Graph IR document                                | adapter, not replacement                    |
| `GraphMode` (closed union)    | `workflow.id` + version                          | modes become templates                      |
| `WorkflowRole` (closed union) | `RoleId` (string)                                | R6; keep enum as coding profile             |
| `NodeKind.command`            | `action`                                         | driver = `command`                          |
| `NodeKind.test`               | `check`                                          | preserve `required` semantics               |
| `NodeKind.router`             | `route`                                          | IR restricts to declarative selectors       |
| `NodeKind.human_approval`     | `human`                                          | decisions become durable outcomes           |
| `NodeKind.context_compile`    | `context`                                        |                                             |
| `NodeKind.evidence_aggregate` | `evidence`                                       |                                             |
| `EdgeCondition` enum          | outcome + `EdgeGuard`                            | `on_*` → declared node outcomes             |
| `guard: 'repair_envelope'`    | `EdgeGuard{type:policy}`                         | policy ref, evaluator stays in daemon       |
| `maxAttempts`                 | `LoopGroup.policy.maxAttempts`                   | per-node → per-SCC is a real semantic shift |
| `maxLoopIterations`           | run safety ceiling                               | keep as secondary failsafe                  |
| `writer: true`                | `effects:[workspace_write]` + concurrency policy | must not weaken                             |
| `authorityRole`               | `roleRef` + permission profile                   | R6                                          |

**The `maxAttempts` → `LoopGroup` mapping is the sharpest edge in R3.** Today the
budget is per-node and the loop ceiling is per-run; IR puts `maxAttempts` on the
loop group. A bug-fix graph where the writer has `maxAttempts: 2` inside a
`maxLoopIterations: 3` graph does not translate to a single number. R3 must keep
both concepts rather than collapsing them, and RF-EVO-036's "where equivalent"
qualifier should be read strictly.

### 6.4 Built-in workflow shapes (R4 snapshot targets)

| Mode       | Nodes | Concurrency | Loop cap | Shape                                                                  |
| ---------- | ----- | ----------- | -------- | ---------------------------------------------------------------------- |
| `direct`   | 3     | 1           | 2        | writer → test → accept                                                 |
| `fast`     | 4     | 1           | 2        | planner → writer → test → accept                                       |
| `bug_fix`  | 7     | 2           | 3        | planner ∥ planner_tests → reviewer → writer → test → verifier → accept |
| `standard` | 7     | 2           | 3        | = `bug_fix` shape, distinct identity                                   |
| `critical` | 7     | 2           | 4        | = `bug_fix` shape, wider loop budget                                   |

`standard` and `critical` are literal spreads of `bugFixGraph`. Three `.roflock`
sources sharing an import is the natural R4 expression, but the compiled IR must
still produce three distinct `workflow.id`s so pinned versions stay
distinguishable.

---

## 7. Runtime regression suite (RF-EVO-004)

The implementation plan lists 13 semantics that must be frozen before the runtime
core changes. Verified against the existing 29 tests in `graph-core` and
`graph-runtime`:

| #   | Semantic to freeze                   | Covered by                                                                                                                                                                                                                       | Status             |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | validation before run                | `rejects an invalid graph before executing anything`                                                                                                                                                                             | ✅                 |
| 2   | dependency ordering                  | `runs a dependency-ordered graph to completion`                                                                                                                                                                                  | ✅                 |
| 3   | concurrency cap                      | `honours the concurrency cap`                                                                                                                                                                                                    | ✅                 |
| 4   | no simultaneous writers              | `never schedules two writers at once`                                                                                                                                                                                            | ✅                 |
| 5   | local `maxAttempts`                  | `spends a local retry budget before failing a node`                                                                                                                                                                              | ✅                 |
| 6   | typed failure-edge routing           | `classifies failures so they route to the right node class`, `routes a failed deterministic check back to the writer`, `routes a non-repairable deterministic failure to planner`, `routes a verifier rejection through planner` | ✅                 |
| 7   | loop cap                             | `stops looping once the loop budget is exhausted`                                                                                                                                                                                | ✅                 |
| 8   | descendant reset after failure route | `resets everything downstream of a loop target so a re-run is not partly stale`                                                                                                                                                  | ✅ **added in R0** |
| 9   | siblings settle on failure           | `keeps a completed parallel sibling honest when another sibling fails`                                                                                                                                                           | ✅                 |
| 10  | artifact gate on role start          | `does not schedule an executor without exact approved input artifacts`                                                                                                                                                           | ✅                 |
| 11  | artifact gate on role completion     | `pins an executor to current inputs and validates its report output`                                                                                                                                                             | ✅                 |
| 12  | required verification before accept  | `a required deterministic failure blocks acceptance`, `rejects a pass path that bypasses a required check`                                                                                                                       | ✅                 |
| 13  | legacy graph version lookup          | `pins a graph to an immutable version`                                                                                                                                                                                           | ✅                 |

Plus four beyond the required list: `setup_required` not routing back through the
writer, `resumes from previously completed nodes after a restart`, node-state
transition reporting, and cancellation without routing.

**Gap (#8), now closed.** Descendant reset on loop re-entry — the behaviour that
makes a re-run honest instead of partially stale — was only exercised
transitively through the loop-budget test. Nothing asserted that a node
_downstream_ of the loop target is reset to `pending`, has its attempt counter
zeroed, and has its prior result discarded. This is exactly the property an IR
bridge could silently break, so R0 adds a direct test
(`packages/graph-runtime/src/index.test.ts`) that runs a
`writer → probe → gate → test → accept` graph with `gate` routing `on_fail` back
to the writer, then asserts `probe` re-executed, that only its fresh result
survives, and that its attempt counter restarted at 1.

The test was mutation-checked: narrowing the runtime's reset from
`descendantsOf(graph, edge.to)` to `[edge.to]` fails it (along with four existing
tests), confirming it guards real behaviour rather than passing vacuously.

`graph-runtime` is now 19 tests; the repository baseline moves from 432 to 433.

---

## 8. Docs: authoritative vs historical

| Path                                                       | Status                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| `docs/adr/ADR-001..019`                                    | **Authoritative** — accepted decisions, still binding       |
| `docs/implementation/` (this file, plan, mapping, backlog) | **Authoritative** — current migration control               |
| `docs/prd/ROFLOCK_OPEN_SOURCE_PRD_v1.0.md`                 | **Authoritative** — target product                          |
| `docs/rfc/RFC-001` (Graph IR)                              | **Proposed** — implementation baseline for R2               |
| `docs/product/roleflock_*`                                 | **Historical** — RoleFlock-era plans; retain, do not delete |
| `docs/security/threat-model.md`                            | **Authoritative** — invariants survive rebrand              |
| `docs/test-plans/`, `docs/benchmarks/`                     | **Authoritative**                                           |
| `docs/public/`                                             | **Authoritative** — needs rebrand copy in R1                |

ADRs that directly constrain migration: ADR-003 (evented SQLite state) predates
and partly pre-implements R5; ADR-004 (process control and recovery) and ADR-010
(billable unknown outcomes) are exactly the R5 invariants; ADR-005 (worktree
writer isolation) is the writer semantics R3 must preserve; ADR-016 (role
authority and planner-owned feedback routing) is the v3 validation rule; ADR-008
(provider adapters) is what R7 evolves.

**No ADR is superseded by this audit.** R2 onwards will need new ones — Graph IR
v1 acceptance, AgentDriver v1, and the generic role model each require an RFC per
the implementation plan §8.

---

## 9. Discrepancies between planning docs and code

### 9.1 R5 is substantially pre-built

The handoff plan presents durable runtime state as new work (RF-EVO-070..086).
The schema already contains `graph_runs`, `node_runs`, `loop_attempts`,
`state_snapshots`, `runtime_leases`, `process_handles`, `invocations`,
`control_commands`, and an `events` table with sequence-conflict detection **and**
an idempotency-key unique index. `EventStore.append()` already implements
idempotent replay and optimistic sequencing, and `packages/database/src/reducers/`
exists.

This changes R5 from "build durable runtime" to "connect the in-memory scheduler
to the durable model that already exists." R5 should be re-scoped after R3 rather
than executed as written.

### 9.2 The runtime is less monolithic than described

The plan describes `runGraph()` as "too in-memory/monolithic." It is 235 lines
with a clean injected-executor boundary (`execute(context)`) and injected hooks
for artifacts, edge guards, and state transitions. The daemon orchestrator (2591
lines) is where the coupling actually lives. Extraction pressure belongs on
`apps/daemon/src/services/orchestrator.ts`, not on `graph-runtime`.

### 9.3 `packages/evidence` is an 8-line stub

The mapping table treats `evidence` as a substantial asset to preserve. It has 8
LOC and no tests. The real evidence depth lives in `change-contracts` (2890 LOC),
`change-passport` (1444 LOC), and `verification-runner` (2659 LOC). R8 should
target those; `evidence` is closer to ADD than KEEP.

### 9.4 `packages/test-support` is a 15-line stub

RF-EVO-114's fake-driver conformance kit and R3's fake deterministic executor both
land here. Treat "EXPAND" as "build" — it starts near zero, and R3 depends on it.

### 9.5 `role-protocol` roles ≠ `graph-core` roles

The mapping doc predicts `WorkflowRole = planner | reviewer | writer | test |
verifier | accept`, which is correct. But `role-protocol` independently defines a
_different_, larger 9-value `RoleId`: `contract_planner`, `contract_authority`,
`planner`, `plan_critic`, `plan_approver`, `executor`, `test_runner`, `verifier`,
`release_approver`. `GraphNode` carries both — `role` (dispatch) and
`authorityRole` (enforcement).

**Two role vocabularies already coexist**, and R6 must generalize both without
merging them prematurely. Dispatch identity and authority identity are genuinely
different concerns; the audit recommends keeping them separate in IR — `roleRef`
for authority, node identity for dispatch — rather than collapsing them into one
field.

---

## 10. Risk register

| #   | Risk                                                                                | Severity     | Mitigation                                                                       |
| --- | ----------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------- |
| 1   | IR bridge silently changes loop semantics (`maxAttempts` vs `LoopGroup`)            | **Critical** | Close gap #8 first; keep both concepts in R3; compatibility fixtures per §6.4    |
| 2   | Rebrand breaks an existing install (data dir, db filename in 3 places, secrets env) | **Critical** | §5 inventory; fallback-then-deprecate; export-service test before touching paths |
| 3   | Version-gated validation rules lost in translation (v1/v2 vs v3)                    | **High**     | Treat graph version as a validation profile, not just a shape key                |
| 4   | `setup_required` / `cancelled` non-routing erased by outcome mapping                | **High**     | Assert in the R3 bridge test suite                                               |
| 5   | `database` upward deps block clean EventStore extraction                            | **High**     | ADR before R5; do not start R5 blind                                             |
| 6   | Second runtime emerges via the compatibility layer                                  | **High**     | One `runGraph`; bridge produces `WorkflowGraph`, never executes                  |
| 7   | `format:check` baseline failure masks a real regression                             | Medium       | Compare against the §1.1 file set; separate formatting commit                    |
| 8   | Orchestrator coupling (2591 LOC) makes R3 integration sprawl                        | Medium       | Bridge at the `getWorkflowGraph` seam (`orchestrator.ts:2589`)                   |
| 9   | Namespace rename churn collides with runtime work                                   | Low          | Nothing published (§2); defer, then do it in one mechanical commit               |

---

## 11. R0 exit checklist

- [x] Baseline commit recorded (`d5bcacb`)
- [x] All six root commands run; results and the one pre-existing failure recorded verbatim
- [x] All 26 packages + 3 apps inventoried with LOC, tests, deps, classification
- [x] KEEP / ADAPT / GENERALIZE / ADD / EXPAND assigned with rationale
- [x] Database schema, env vars, data paths, config filenames, media types inventoried
- [x] All 15 pinned graph version ids enumerated
- [x] Docs classified authoritative vs historical
- [x] Runtime regression coverage mapped against the 13 required semantics
- [x] Gap #8 closed — direct test for descendant reset on loop re-entry
- [x] Risks recorded with mitigations

**R0 is complete.** No runtime behaviour was changed by this phase; the only code
change is one added test.

### Recommended next actions

1. R1 rebrand, sequenced by §5's compatibility surface — **not** a global
   search-and-replace. Start with product copy and the `roflock` CLI alias, and
   treat the data-path work (§5.1) as its own carefully tested ticket.
2. R2 adds `graph-ir` then `language`, per the §3.1 decision to avoid a five-way
   package split before the vertical slice is green.
3. Before R5, resolve the `database` layering question from §4.2 with an ADR —
   and re-scope R5 against what §9.1 shows already exists.

---

## 12. R1 outcome — Roflock rebrand

R1 is complete. Nothing was renamed by search-and-replace; every item was
decided against the §5 compatibility surface.

| Ticket                      | Outcome                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| RF-EVO-010                  | README leads with Roflock positioning and names the unbuilt parts explicitly                                        |
| RF-EVO-011, RF-DIST-002/003 | `roflock` executable with `--help`/`--version`; `roleflock` warns and keeps working                                 |
| RF-EVO-012                  | `readEnv()` resolves `ROFLOCK_*` with a `ROLEFLOCK_*` fallback across ten variables; child processes get both names |
| RF-EVO-013                  | Data directory is _resolved_, never moved; database filename centralised                                            |
| RF-EVO-014                  | `roflock.config.example.yaml`, both locations documented                                                            |
| RF-EVO-015                  | Resolved by §2 — deferred, now with a publish deadline                                                              |
| RF-EVO-016                  | Apache-2.0 LICENSE, NOTICE, SECURITY.md, expanded CONTRIBUTING                                                      |

Verification after R1: build, lint, typecheck pass; **459 tests pass**, up from
the 432 baseline. Prettier's flagged set shrank by two and gained nothing.

### What R1 deliberately did not rename

Each of these looks like a rebrand target and is not one:

- **`ROLEFLOCK_CHECK_*` / `ROLEFLOCK_PASSPORT_*`** in `github-protection-gate`
  are published GitHub status-check codes, not environment variables. Users'
  branch protection rules match on these strings; renaming them silently breaks
  a merge gate.
- **`x-roleflock-token`, `x-roleflock-csrf`, `roleflock_token` cookie** are a
  wire protocol between `apps/web` and the daemon. Renaming them is a
  coordinated two-sided change and needs its own ticket.
- **`roleflock.db`** and its `-wal`/`-shm` siblings. Renaming the directory only
  requires resolution to look in two places; renaming the database means moving
  a live file that a daemon may hold open. The name is now a single constant, so
  the change is one edit whenever it is judged worth the risk.
- **Change Passport media types** (`application/vnd.roleflock.change-passport+json`).
  Users may hold exported passports carrying these strings.
- **Root package `name`** and the `@roleflock/*` namespace — RF-EVO-015.

### New risks introduced by R1

| #   | Risk                                                                                                                                            | Severity | Mitigation                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| 10  | `print-url.mjs` and `diagnostics.mjs` duplicate `resolveDataDir()` because they run without the built workspace; they can drift                 | Medium   | Both carry a pointer comment to `apps/daemon/src/data-dir.ts`; a shared build-free module would remove it |
| 11  | Data directory resolution is sticky — a user who creates `~/.roflock` by hand while running from `~/.roleflock` silently switches installations | Low      | Documented in README; resolution prefers the new directory only because a hand-created one signals intent |
| 12  | Legacy env deprecation warnings are per-process, so a short-lived CLI invocation repeats them                                                   | Low      | Acceptable; the alternative is persisting notice state, which is worse                                    |

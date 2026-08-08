# Roflock Repository Audit

**Status:** R0 baseline frozen; R1 recorded in §12, R2 in §13
**Tickets:** RF-EVO-001, RF-EVO-002, RF-EVO-003, RF-EVO-005 (+ phase summaries)
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

**How to read this.** Every row is a risk _with its mitigation_, recorded when it
was identified — not a list of outstanding work. A struck-through row was later
eliminated outright and says where. Rows added by later phases appear in that
phase's section rather than here, so the register stays a record of what was known
at each point rather than being rewritten.

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

---

## 13. R2 outcome — Graph IR and the language

R2 is complete. `.roflock` source compiles to canonical Graph IR, is validated,
and round-trips through the CLI inside the real monorepo:

```bash
roflock check examples/bugfix.roflock
roflock compile examples/bugfix.roflock -o bugfix.ir.json
roflock validate-ir bugfix.ir.json
```

| Ticket             | Outcome                                                      |
| ------------------ | ------------------------------------------------------------ |
| RF-EVO-020/021     | `packages/graph-ir` — types, canonical hash, IR-02 validator |
| RF-EVO-022/023     | `packages/language` — tokenizer, AST, parser, compiler       |
| RF-EVO-024         | `examples/linear.roflock`, `examples/bugfix.roflock`         |
| RF-EVO-025/026/027 | `roflock check`, `compile`, `hash`, `validate-ir`            |
| RF-EVO-028         | Both packages join root build/lint/typecheck/test            |

Verification after R2: build, lint, typecheck pass; **537 tests pass**, up from
459 after R1 and 432 at baseline. Prettier's flagged set is still unchanged.

### Decisions taken

**One `language` package, not five.** RFC-001 §30 proposes splitting
`language-core` / `-parser` / `-compiler` / `-formatter`. §3.1 of this audit
chose to defer, and R2 confirmed it: the parser and compiler share the AST and
diagnostics closely enough that a split would be wiring, not a boundary. Revisit
when the LSP arrives — it is the first consumer that genuinely needs the parser
without the compiler.

**The compiler derives what the author does not write.** Outcome contracts come
from node kind, entry nodes from SCC condensation, loop groups from the strongly
connected component a `{ max N }` edge creates. This is the main reason the AST
is a separate structure rather than IR with spans: an AST that already carried
derived facts could not report a useful error about what was actually typed.

**`max_cost N` was added to v0.1.** The validator warns (RF601) when a looping
workflow declares no budget, and v0.1 originally had no way to satisfy it, so
every realistic example shipped with a warning. It lowers to `onExceeded:
'pause'` — hitting a ceiling is a question for the operator, not a reason to
discard work already paid for.

**Keywords are not reserved.** They are lexed as identifiers and given meaning
by position, so a node may be called `Check` and adding a declaration keyword in
v0.2 cannot break a workflow someone already wrote.

### Known gaps carried into R3

| Gap                                                                                                                                        | Consequence                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `graph-ir` reaches `node:crypto` through `@roleflock/contracts` for its digest                                                             | Not browser-safe; RF-EVO-150 must replace the digest for the Playground   |
| No formatter (`roflock format`)                                                                                                            | RF-EVO-... under R2's "later"; required before a public language release  |
| v0.1 has no syntax for goals, acceptance criteria, profiles, joins, routes, or events, though the IR models all of them                    | Hand-written IR can express more than source can; R4 may need more syntax |
| `deriveLoops` builds one group per annotated edge; two `{ max N }` edges in one SCC would produce overlapping groups the validator rejects | Nested or multi-exit loops are not yet expressible                        |

### New risks

| #   | Risk                                                                                                                      | Severity | Mitigation                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| 13  | The `maxAttempts`-per-node vs `LoopGroup`-per-SCC mismatch (risk #1) is now concrete — the compiler only emits the latter | **High** | R3 must map both; do not collapse them. `deriveLoops` is the single place the compiler's view is formed |
| 14  | Source spans live in `debug`, excluded from the hash, so a stored IR document cannot always point back at source          | Low      | `uri` and `sourceHash` are recorded in `workflow.source`; the file itself is the source of truth        |

---

## 14. R3 outcome — Graph IR runtime bridge

R3 is complete, and it is the milestone the whole migration was sequenced
around. A `.roflock` workflow compiles to Graph IR, bridges to a
`WorkflowGraph`, and executes on the existing `runGraph` — the same scheduler,
writer serialisation, typed failure routing and artifact gating that has been
running in production. **There is no second runtime.**

`packages/graph-core/src/ir-bridge.ts`, ~250 lines, plus 19 integration tests in
`graph-runtime` that use the real compiler and the real `runGraph` with a fake
deterministic executor.

| Ticket     | Outcome                                                                |
| ---------- | ---------------------------------------------------------------------- |
| RF-EVO-030 | `graphIrToWorkflowGraph(ir): BridgeResult` — one explicit boundary     |
| RF-EVO-031 | Success outcomes become `dependsOn`; the runtime schedules unchanged   |
| RF-EVO-032 | agent, model_call, check, action, human mapped; others refused         |
| RF-EVO-033 | IR outcomes → typed `EdgeCondition`, terminals never routed out of     |
| RF-EVO-034 | `workspace_write` or a writing role → `writer: true`                   |
| RF-EVO-035 | `check.required` → `required: true`, enforced by the legacy validator  |
| RF-EVO-036 | `LoopGroup.maxAttempts` → node budget **and** `maxLoopIterations - 1`  |
| RF-EVO-037 | Human nodes become `human_approval`; accept versus reviewer by outcome |
| RF-EVO-038 | Role Protocol authority is opt-in by role id                           |
| RF-EVO-039 | Fake-executor integration suite                                        |
| RF-EVO-040 | Fail → retry → pass end to end, plus exhaustion                        |

Verification after R3: build, lint, typecheck pass; **556 tests pass**
(432 baseline → 459 → 537 → 556). Prettier's flagged set still unchanged.

### The maxAttempts / LoopGroup resolution

Risk #1 from R0, made concrete in R2, resolves as:

```text
IR:      LoopGroup.maxAttempts = 3          (three attempts)
legacy:  loopTarget.maxAttempts = 3         (the node's own retry budget)
         graph.maxLoopIterations = 2        (re-entries: attempts - 1)
```

The off-by-one is the whole point. `runGraph` counts _re-entries_, so a ceiling
of 3 would have produced four attempts and one extra billable provider call per
loop. Legacy deliberately keeps two bounds where IR has one; the bridge sets
both from the single IR budget rather than dropping either. The existing
built-in graphs use the same convention — `bugFixGraph` puts the repair budget
on the writer, which is its loop target — so this is the legacy encoding, not a
new one.

### Decisions taken

**Derived, never guessed.** Every legacy field comes from a fact the IR already
carries. Where the legacy model cannot represent something — an `event` node, a
route out of a terminal outcome — the bridge emits a diagnostic and no graph.
Silently dropping a node the author wrote would be the worst available
behaviour.

**Authority is opt-in.** An IR role whose id is a Role Protocol role gets that
role's artifact gate; anything else leaves `authorityRole` undefined, exactly as
legacy v1 and v2 graphs do. This preserves enforcement for workflows that ask
for it without inventing authority for those that did not.

**Topological node order.** IR normalises nodes by id for hashing, but
`runGraph` sorts a run's results by node order, so an alphabetical graph would
report `Accept` before `Builder` in the run view. Found by a test asserting
result order, not by reading the code.

**`WorkflowGraph.id` widened to `string`.** It is display and event-payload
only — never dispatch — so a bridged graph can carry its own workflow id
alongside the built-in `GraphMode` templates.

### Known gaps carried into R4

| Gap                                                                                                 | Consequence                                                                                 |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| The daemon orchestrator still calls `getWorkflowGraph`; nothing runs bridged IR in the real product | R4 must switch new-task graph resolution to compiled templates (RF-EVO-061)                 |
| `action`, `context`, `evidence`, `join` and `route` are mapped but untested end to end              | v0.1 syntax cannot express them, so no fixture exercises the mapping                        |
| `blocked` folds into `on_fail`                                                                      | A widening, not a loss — `on_fail` is already the runtime's catch-all — but recorded        |
| Bridged graphs are versioned `<workflowId>@3`, so they get v3 validation rules                      | Correct and strictest, but `getWorkflowGraph` cannot resolve them; they are passed directly |

### New risks

| #   | Risk                                                                                               | Severity | Mitigation                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 15  | `dispatchRole` infers `verifier` versus `planner` from graph position when a role declares no slot | Low      | R6 added `dispatch <slot>`, and a declaration always wins; inference remains only as the default for workflows that do not care |
| 16  | Two graph validators now exist — `validateGraphIR` and legacy `validateGraph` — and could drift    | Medium   | The bridge runs the legacy one and reports its errors as diagnostics, so drift surfaces as a bridge failure                     |

---

## 15. R4 outcome — built-in workflows as source

R4 is complete. Direct, Fast, Bug Fix, Standard and Critical live in
`workflows/*.roflock` and compile through the same public compiler any user
workflow does. The hard-coded TypeScript definitions remain as **history**, not
as the source of truth.

Verification after R4: build, lint, typecheck pass; **589 tests pass**
(432 → 459 → 537 → 556 → 589). Prettier's flagged set still unchanged.

### Parity is exact

Each compiled workflow produces the same _governing shape_ as the template it
replaces — node ids, dispatch roles, kinds, dependencies, writer flags, required
checks, retry budgets, authority, focus presence, guarded failure routes,
concurrency and loop ceilings. Behavioural tests additionally run both graphs
against the same fake executor and compare invocation counts on the happy path
and at loop exhaustion.

Only `label` and `description` are excluded from the comparison, as display copy.

### Two divergences the tests caught

Both were fixed rather than documented away, and both were found by a test
rather than by reading the diff.

1. **Accidental authority.** R3's opt-in-by-name meant a role called `planner`
   silently acquired Role Protocol artifact gates. The compiled workflows
   started failing at the gate with `Required input is missing: change_contract`
   — nothing in the source explained why. Authority is now declared explicitly
   with `authority <profile>`, and `authorityRole` joined the parity comparison
   so the same class of divergence cannot hide again.
2. **Accidental swarm assignments.** Every agent was receiving a `focus`, which
   the runtime injects into the prompt as "Your independent swarm assignment".
   The field exists to tell _parallel_ agents sharing a role how their work
   differs, so the bridge now emits it only for nodes with a sibling — matching
   the built-ins, which give one only to the two parallel planners.

### Language additions, each forced by a real workflow

| Syntax                | Why it had to exist                                                  |
| --------------------- | -------------------------------------------------------------------- |
| `reviews` on an agent | Adds the `changes` outcome; without it no reviewer loop can be drawn |
| `retry N`             | A node's own budget, distinct from a loop's attempt budget           |
| `authority <profile>` | Explicit enforcement binding, replacing R3's name-based inference    |
| mid-flow `human`      | Terminal-ness derived from having outgoing edges, not assumed        |

`retry N` travels as a namespaced annotation (`roflock.coding/retry-budget`)
because IR v1's `NodeBase` has no field for it and **changing the frozen schema
needs an RFC**. That is a deliberate deferral, recorded here so it is not
mistaken for an oversight.

### Loop grouping, and the gap from §13

R2 recorded that `deriveLoops` emitted one group per annotated edge and would
produce overlapping groups for two bounded edges in one component. R4 forced the
fix: the assurance workflows route a failing check both back to the writer and
further back to the planner, and additionally route verifier findings to the
planner. Loops now group by strongly connected component, with one shared
budget — which is also exactly what the runtime does, since it keeps a single
re-entry counter for the whole graph.

Where several nodes gate one cycle, the one furthest along the success path is
named as the loop's verifier. It is the last word on whether an attempt
succeeded, and every route out shares the budget regardless.

### Resolver behaviour

```text
resolveWorkflowGraph('bug_fix@3')  → compiled source, relabelled bug_fix@3
resolveWorkflowGraph('bug_fix@1')  → hard-coded definition, always
resolveWorkflowGraph('bug_fix@99') → refused, never substituted
```

`graph-core` receives compiled graphs rather than reading the filesystem, so it
stays importable by the browser-facing UI. The daemon loads and registers them
at boot; a template that no longer compiles is reported to stderr and falls back
to its built-in definition, degrading to today's behaviour rather than leaving
the daemon with no workflow.

### New risks

| #   | Risk                                                                                                | Severity | Mitigation                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 17  | The template registry is module-level mutable state, so test order can affect which graphs resolve  | Medium   | Tests clear it in `afterEach`; a per-daemon instance would remove the hazard entirely                                             |
| 18  | ~~`workflows/` is located by walking up from the daemon module and will not survive npm packaging~~ | Closed   | RF-DIST-001: the build bundles templates into `dist/workflows`; a packaged daemon finds them, dev still reads the repository copy |
| 19  | ~~Shipped templates declare no `authority`, so Role Protocol gates are unused~~                     | Closed   | Investigated: authority cannot apply uniformly — see §23. Deliberate, not pending                                                 |

---

## 16. R5 progress — durable runtime (partial)

**R5 is not complete.** This section records what landed, what did not, and why
the remaining work is smaller than the backlog implies.

Verification: build, lint, typecheck pass; **616 tests pass**
(432 → 459 → 537 → 556 → 589 → 601 → 616). Prettier's flagged set is 66 tracked
files, two fewer than baseline, with nothing added.

### Gate: ADR-020

The `database` layering question §4.2 raised is decided. The package is a
storage kernel whose dependencies are already correct, plus forty domain
repositories whose upward imports are a recorded exception. New durable runtime
state is defined in `contracts` and persisted through the kernel.

### Landed

**The repair budget survives a restart (RF-EVO-073).** `runGraph`'s loop counter
started at zero on every call, so resuming a crashed run handed the task a whole
new budget — a run that had already spent three attempts could spend three more,
paying a provider each time. It now accepts `resumeLoopIterations` and reports
each re-entry through `onLoopIteration` _before_ the target resets, so an
attempt that was paid for is recorded even if the daemon dies between the
decision and the retry. The orchestrator writes those to `loop_attempts`, a
table that had existed since migration 001 and had never been written to.

**A billable turn has a stable identity (RF-EVO-080).** Invocation ids were
random per attempt, leaving a resumed run unable to tell work already paid for
from work that never started. `stableInvocationKey` hashes task, graph version,
semantic hash, node, attempt and loop iteration; migration 034 stores it behind
a partial unique index so the database refuses a duplicate even from a caller
that skipped the lookup.

### Already existed — the backlog overstates R5

Audit §9.1 predicted this and R5 confirmed it. These need no work:

| Backlog ticket                         | Reality                                                       |
| -------------------------------------- | ------------------------------------------------------------- |
| RF-EVO-076/077 EventStore + SQLite     | Exists, with idempotent replay and optimistic sequencing      |
| RF-EVO-079 snapshots                   | `state_snapshots` + `SnapshotRepository`, used by the reducer |
| RF-EVO-081 explicit OUTCOME_UNKNOWN    | Exists in `run-control` and is applied at boot                |
| RF-EVO-082 boot reconciliation         | `reconcileInterruptedGraphRuns` marks leftovers `interrupted` |
| RF-EVO-083 process reconciliation      | `reconcileOrphanedProcesses` probes liveness before the sweep |
| RF-EVO-084 writer lease reconciliation | `reconcileWriterLeases` releases leases a process cannot hold |

One thing worth correcting from an earlier reading: the boot sequence runs
orphan-process reconciliation **before** the interrupted-run sweep, so a
billable invocation with a live process handle gets `OUTCOME_UNKNOWN` rather
than being flattened to `interrupted`. ADR-010 is honoured.

### Not done

**R5 is complete.** Every ticket in the phase is either done or recorded as
already existing.

The forced-restart end-to-end (RF-EVO-085) runs against the real daemon: a task
reaches the plan approval gate, the daemon is killed, a second boots on the same
data, and the run continues without buying the planners' work again. It measures
**invocations**, not node runs — a resumed run writes a marker node run for work
it inherited, so counting rows would call resumption a repeat.

### The strand that test found

`resolveConfirmation` resolved an in-memory waiter and then marked the task
`running`. After a restart the waiter is gone, so approving recorded the
decision, claimed the task was running, and left nothing executing —
permanently, because `running` is a state `/start` refuses. The task could not
be resumed from the UI at all.

It now sets `paused` when no run is waiting. The existing recovery test had
asserted the `running` flip and stopped, which is why this survived: it checked
the state change rather than that anything resumed.

### Known limitation

Resuming past an approval gate re-enters the graph at the reviewer, so the human
is asked to approve again. This fails toward more oversight rather than less, so
it is safe, but it is not yet pleasant and is worth fixing when the approval UI
is revisited in R10.

R5's safety properties — no duplicated billable work, no refreshed repair
budget, no guess about an unobserved turn — are done and tested. The modelling
work is done too: `RuntimeEvent` gives the five transitions a
contract, `reduceGraphRun` folds them deterministically, and the
walking-skeleton end-to-end projects every run a real orchestrated task
produced.

What remains is the switch itself. The events are recorded **beside** the
orchestrator's SQL writes, not instead of them, which is what the plan asks for —
"first instrument existing behaviour, then move behaviour behind durable state".
Moving the orchestrator to read from the projection is the last step and is
deliberately not taken here, because doing it in the same change would have
removed the ability to compare the two.

### The reducer refuses rather than repairs

Illegal histories throw: a node settling without a start, a run starting or
settling twice, and — the one that costs money — a gap in the re-entry count,
which would understate what was already paid for. A projection that quietly
fixes a contradictory history hides whatever produced it.

Events are keyed by graph run rather than by task, so one task's several runs
project independently and a resumed run inherits exactly what its own start
event says.

### RF-EVO-086, and where the guarantee stops

An unresolved billable turn now stops the run instead of being repeated. The
boundary is worth stating precisely:

- the **record** cannot be duplicated — the database refuses it;
- the **provider** is no longer re-invoked on a resume, because the node fails
  with `outcome_unknown` before any invocation is made;
- what does **not** exist yet is a way for a human to _resolve_ the invocation.
  The run stops and says why, but marking a turn "it did complete, continue" or
  "it never billed, retry" needs UI and API that R10 supplies. Until then the
  operator's only move is starting the task over — safe, but blunt.

The rule is deliberately narrow. A deterministic check re-runs freely because
nothing was billed. A turn with a definite outcome is the graph's retry budget's
business, not this gate's.

### New risks

| #   | Risk                                                                                                                            | Severity | Mitigation                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| 20  | `loop_attempts` rows attach to the node run that _triggered_ the loop; if that run's row is missing the attempt is not recorded | Medium   | The orchestrator keeps `lastNodeRunId`, but a node that never opened a run would be silently uncounted           |
| 21  | ~~An invocation found under an existing key is reported but does not stop the node~~                                            | Closed   | RF-EVO-086: `outcome_unknown` routes nowhere and the run stops as `interrupted` for a human to resolve (ADR-010) |
| 22  | Semantic hash reaches the key only for compiled templates; built-ins pass `undefined`                                           | Low      | Intentional and distinguished from any hash; built-ins have no source to change                                  |

---

## 17. R6 outcome — generic roles

R6 is complete. A workflow may name its roles anything and still receive every
coding guarantee: the writer lease, the unbypassable required check, the bounded
repair loop, and Role Protocol artifact gates for roles that ask for them.

Verification: build, lint, typecheck pass; **661 tests pass**.

### What changed

Audit risk 15 is closed. The runtime adapter inferred a role's dispatch slot
from its access mode and position in the graph. That inference is right often
enough to stay as the default, and wrong often enough that a workflow needed a
way to override it — `dispatch <slot>` is that way, and a declaration always
wins.

Dispatch lives in the `roflock.coding/v1` extension rather than in
`RoleDefinition`. Core Graph IR knows nothing about verifiers, and putting a
coding convention into the role type would have made every non-coding workflow
carry it. The RFC's extension rules then earn their keep: a host that does not
understand the coding pack rejects the document instead of executing less than
it says.

### What did not change

`ROLE_AUTHORITY_MATRIX` is untouched and remains the coding authority profile.
Roles stay ungated unless they declare `authority`, and a custom role that opts
in still fails at the artifact gate before any work is paid for. Generalising
the _names_ did not loosen the _enforcement_, which was the whole risk.

### Already satisfied by earlier phases

| Ticket     | Where it landed                                                       |
| ---------- | --------------------------------------------------------------------- |
| RF-EVO-091 | `RoleDefinition` in `graph-ir` since R2                               |
| RF-EVO-094 | `ArtifactType` and `Port` since R2                                    |
| RF-EVO-096 | `ArtifactTypeMismatch` / `MissingArtifactProducer` diagnostics        |
| RF-EVO-097 | Producer-after-consumer detection in `validateGraphIR`                |
| RF-EVO-098 | `LoopGroup.policy.requireNewEvidence`, defaulted true by the compiler |

---

## 18. R7 progress — AgentDriver (partial)

The contract, the reference driver and the conformance suite are in.
Verification: build, lint, typecheck pass; **672 tests pass**.

### Landed

| Ticket         | Outcome                                                    |
| -------------- | ---------------------------------------------------------- |
| RF-EVO-110/111 | `AgentDriver` and `DriverCapabilities` in `provider-core`  |
| RF-EVO-112/113 | `AgentRunRequest`, `AgentEvent`                            |
| RF-EVO-114     | `FakeDriver` plus `runDriverConformance` in `test-support` |
| RF-EVO-122     | Cancellation truthfulness, enforced by conformance         |

### The compatibility wrapper (RF-EVO-115)

`providerDriver()` presents an existing `ProviderAdapter` as an `AgentDriver`,
and passes the same conformance suite a hand-written driver does. That is what
makes the migration incremental: the runtime can move to drivers before Codex,
Claude or Cursor is rewritten.

It is pessimistic on purpose. No health check means `detected: false` rather
than "probably ready"; an adapter that ends without saying how settles as
`failed`, not `completed`; and permissions are enforced at the wrapper rather
than delegated, because an adapter cannot honour a restriction its envelope
never described.

**One design change came from a failing test.** `cancellation` was overridable,
and a test expecting conformance to catch an overclaim failed — the lie was
_self-consistent_. `interrupt` agreed with the raised claim, so no contradiction
existed to find, and a user would have been told their work stopped while a paid
provider carried on. It is now absent from the override type and restated in the
implementation, so a cast cannot route around it either. Unrepresentable beats
caught.

### The decision worth remembering

`cancellation` is a four-value capability, not a boolean, because the difference
between them is money. `local-process` means a process here was killed and says
nothing about a request already in flight to a paid API. Only `remote-confirmed`
permits telling a user their work stopped. `stopIsConfirmable` makes that a
function rather than a convention, and conformance fails any driver that reports
a stop it cannot prove.

`detected` and `authenticated` stay separate for the same class of reason: an
installed CLI nobody logged into is common, and calling it ready sends a run to
a provider that will refuse it.

### Shipped drivers (RF-EVO-116/118/121)

Codex, Claude and the OpenAI-compatible endpoint each expose a driver factory,
and all three pass conformance. They wrap the working adapters — the CLI process
handling, sandbox flags and failure classification are the parts worth keeping.

Conformance runs against a fake CLI. A driver's honesty about itself is
checkable offline, and a suite that needed Codex installed is a suite nobody
runs. It does **not** establish that the real CLIs behave as their adapters
expect; that needs the real binaries, which is why `ProviderAdapter` stays.

**A contract hole surfaced while testing.** `codexDriver('/not/a/real/binary')`
threw out of `start()` instead of emitting events, so conformance could not run
against it at all — and a missing CLI is the most ordinary failure a driver has.
The wrapper now catches an adapter throw and settles as `failed` with its
reason, keeping the promise that a run emits events and ends in `settled`.

### Verified against the real CLIs (RF-EVO-117, RF-EVO-119)

Codex and Claude Code were installed on the machine this migration was done on,
so conformance ran against the real binaries. Both pass. Claude's actual stream
is `started → usage → output → settled(completed)`.

The live suite is doubly gated — CLI present _and_
`ROFLOCK_LIVE_DRIVER_TESTS=1` — because each run spends a real provider turn. A
suite that quietly bills someone on every `pnpm test` is one people stop
running.

**It found a real bug immediately.** Codex reports why a turn failed on
_stdout_, as a JSON event; stderr carries only incidental notices. The adapter
read stderr, so a run that failed on an exhausted quota reported "Reading
additional input from stdin..." — and `classifyProviderFailure` saw that text
rather than the real reason.

Quota is the one failure kind that changes routing rather than wording: the
router parks an exhausted provider+model and moves on. Misclassified as
`unknown`, it kept retrying something that could not succeed until the window
reset. Fixed, and confirmed against a genuinely quota-exhausted account.

The live stream test does not assert success. A real account can be out of
quota, and a run that fails _for a stated reason_ is a correct outcome — what
must hold is that the stream is coherent and explains itself.

### OpenCode, and the safety property it forced (RF-EVO-120)

Verified against the installed CLI. Two findings came from running it rather than
reading its documentation.

**It edits files without being asked.** `opencode run` performed an `edit` tool
call with no `--auto` flag and no permission prompt, and there is no sandbox
option — `--dir` is a working directory, not a boundary. Roflock therefore
**refuses** a read-only turn on this provider rather than passing it through: a
permission nothing enforces is worse than one never offered. `--auto` is never
passed either, since it approves everything unscoped, shell commands included.

`writes: true` is declared even though it is the less convenient answer.
Declaring false would not stop OpenCode writing; it would only stop Roflock
knowing that it might.

**Conformance caught an overclaim on the first live run.** OpenCode has real
sessions — `--session`, `--continue`, a `sessionID` on every event — so
`sessions: true` was declared. It failed: `InvocationEvent`'s
`invocation.started` has no field to carry that id, so the capability exists in
the CLI but cannot reach the runtime through this seam. Now false, with the gap
tracked as RF-EVO-123. This is precisely what the suite is for, and it took
seconds.

Discovery had a gap too: OpenCode installs to `~/.opencode/bin`, which a
non-login shell often lacks on PATH, so looking only for `opencode` reported a
working install as missing.

### A claim corrected

The wrapper's write guard was first described as permission _enforcement_. It is
not: it matches words in the objective, so "modify the payment module" is
refused while "refactor billing" passes through. What confines an adapter is the
permission envelope it receives — empty `allowedPaths`, `allowCommands: false` —
enforced by the CLI's own sandbox. Calling a regex over prose a security
boundary is the mistake this project refuses everywhere else, and tests now pin
both what the guard catches and what it does not.

### R7 is complete

All four drivers pass conformance. Three were verified against the real
binaries — Claude, Codex and OpenCode — and the live suite is 43 tests behind the
`ROFLOCK_LIVE_DRIVER_TESTS=1` gate.

Session identity now reaches the runtime: `InvocationEvent.invocation.started`
carries an optional `sessionId`, and `resume()` was proven end to end against
OpenCode — a first turn asked to remember 41, a resumed turn answered "41".
Context genuinely carries; the capability is not a label.

Usage is declared where it was measured, not where it was assumed.

`ProviderAdapter` remains in place. Nothing required its removal, and the plan
is explicit that compatibility outlives the driver it was replaced by.

### What conformance learned along the way

Three rules were wrong on first attempt, and each was corrected by a test rather
than by review:

1. **Resume was checked by method presence.** Every wrapped adapter has the
   method, so a presence check failed all of them. What matters is behaviour: a
   driver that cannot resume must _refuse_ rather than quietly start fresh, since
   a caller would otherwise believe prior context was carried.
2. **Usage was checked on any turn.** An exhausted quota produces none
   legitimately, so an honest failure read as a lying capability. Now checked
   only on a turn that succeeded.
3. **Fake CLIs printed nothing**, which would have let a driver pass while
   claiming capabilities the fake never exercised. They now emit the streams
   observed from the real binaries.

---

## 19. Where the migration stands

| Phase | State   | Substance                                                            |
| ----- | ------- | -------------------------------------------------------------------- |
| R0    | done    | Baseline frozen, 26 packages classified, risk register               |
| R1    | done    | Rebrand with no destructive rename; `~/.roleflock` still works       |
| R2    | done    | `graph-ir` + `language`; `.roflock` compiles and round-trips         |
| R3    | done    | Compiled IR executes on the **existing** runtime                     |
| R4    | done    | All five built-in workflows are source, at exact parity              |
| R5    | done    | Durable loop budget, stable invocation identity, restart recovery    |
| R6    | done    | Generic roles without weakening coding authority                     |
| R7    | done    | Four drivers pass conformance; Claude, Codex, OpenCode verified live |
| R8    | done    | Evidence chain that names its own gaps                               |
| R9    | done    | Browser Playground on a shared, browser-safe compiler and layout     |
| R10   | partial | Shared diagram contract served; Studio UI outstanding                |

Tests: 432 at baseline → **794**, plus 43 live driver tests behind
`ROFLOCK_LIVE_DRIVER_TESTS=1`. Prettier's flagged set is 61 tracked files, seven
fewer than baseline, with nothing added.

The architectural spine is complete and no longer changing: source → IR →
validation → bridge → **one** runtime, with durable state, honest recovery, and
an evidence chain beneath it. What remains in R10 is interface work on top of
contracts that are already tested.

### A note on how this document was maintained

Four times during this migration an exact-match text edit to these documents
failed silently after Prettier reflowed the paragraph or table it was matching —
leaving a heading updated while the text beneath it went stale, most visibly a
phase pointer that told three successive readers to start R3. Each was caught by
something checking the result rather than by re-reading the diff.

The lesson generalises past tooling: **a document that records state needs the
same verification as code that computes it.** Tables keyed by phase turned out to
be easier to keep honest than prose, because a missing row is visible in a way a
stale sentence is not.

---

## 20. R8 outcome — evidence and provenance

`packages/evidence` was the 8-line stub §9.3 flagged. It now answers the
question the whole product exists to answer — _why should I believe this change
is safe?_ — from records written while the run happened.

Verification: build, lint, typecheck pass; **681 tests pass**.

### The design rule

**A missing link is shown, not omitted.** An explanation that quietly skips the
verification step reads like a run that needed no tests, which is precisely the
impression evidence exists to prevent. Every question in the chain appears
whether or not it was answered; gaps are listed by name; and the output ends by
saying that an absent record is not evidence of absence of a problem.

The chain is fixed in order — authorised, planned, changed, verified, reviewed,
accepted, disclosed — so the shape of the answer does not vary with the shape of
the run. A reader learns where to look once.

### Two smaller decisions

`roflock evidence` exits 0 even with holes in the chain. Gaps are the answer,
not a command failure; exiting non-zero would make a script treat an honest
report as a broken tool.

Both commands read the local database directly rather than going through the
daemon. Evidence that needs a service running to be read is evidence that
disappears exactly when someone most needs it.

### Not done

Existing delivery-assurance depth — Change Contract, Execution Plan,
Verification Specification, Change Passport — is _cited_ by the explanation but
not yet unified into one artifact provenance model (RF-EVO-130's fuller form).
The chain reads those tables directly. That is enough to explain a run and not
enough to replay one, and the difference should not be overstated.

---

## 21. R9 progress — browser-safe compiler (partial)

RF-EVO-150 is done and it was R9's only true blocker. `graph-ir` carried one
import of `node:crypto` via `@roleflock/contracts`, which made the package — and
the compiler above it — unimportable in a browser.

It now has a portable SHA-256 and no platform dependency at all. `language`
never had one, so the whole authoring path is browser-safe:

```text
.roflock source → tokenizer → parser → compiler → Graph IR → validator
```

Verification: build, lint, typecheck pass; **700 tests pass**.

### Why the digest had to be byte-identical

Not merely correct. A hash that differed from `node:crypto` would have silently
invalidated every recorded invocation identity instead of failing loudly, so it
is tested three ways: published NIST vectors, agreement with `node:crypto`
across block boundaries and multi-byte UTF-8, and canonical-JSON agreement with
the shared implementation in `contracts`. `examples/bugfix.roflock` still hashes
to `sha256:4129e2ba…`, exactly as before the swap.

### Shared rendering model (RF-EVO-151, RF-EVO-155)

`packages/graph-ui` projects Graph IR into something drawable, browser-safe and
DOM-free. It computes _what_ to draw, never how — no measurement, no styling, no
framework — which is the only reason a diagram can be tested at all, and testing
it matters because one that quietly omits a failure route misrepresents a
workflow's safety.

Ranking is longest-path, so a node is never drawn above something it depends on.
Declaration order breaks ties, so the same document always draws identically; a
layout that shifted between renders would be useless for spotting what changed.

`roflock render` completes the CLI surface RFC-001 §29 describes, emitting
Mermaid so one diagram works in a terminal, a README, a pull request and the
docs without any of them needing a renderer Roflock ships.

### The Playground (RF-EVO-152..159)

`apps/playground` — a workflow editor that compiles in the browser using the same
compiler, validator and layout model the runtime and CLI use. That is the claim
worth defending: a diagram or diagnostic shown there is the one Roflock would act
on, not an approximation from a second implementation.

It reaches nothing — no daemon, no filesystem, no shell, no credentials. The PRD
forbids a public origin reaching local execution, and an app with no server to
call guarantees that rather than policing it. One 75 kB gzipped static bundle.

Three decisions:

- **No partial graphs.** Source that does not compile draws nothing. Rendering
  from stale IR beside a list of errors would suggest the errors are cosmetic, and
  half a workflow means something different from the whole one.
- **Diagnostics before the picture**, with the same codes the CLI prints, so
  someone who learns RF121 in the browser reads the same code in CI.
- **Share links carry the source.** There is no server to store a snippet on, and
  the workflow travels in the URL fragment — which browsers never send anywhere.
  Sharing a workflow for review should not mean uploading it.

R9 is complete.

---

## 22. R10 progress — Studio (partial)

### The shared diagram contract (RF-EVO-170, RF-EVO-172)

A real blocker had to be removed first: **the bridge is one-way.** It lowers
Graph IR into a `WorkflowGraph` and the IR is not recoverable from the result, so
the daemon had nothing to lay out. A Studio diagram would have had to compute
positions from the runtime graph — a second implementation, which is exactly the
divergence `graph-ui` exists to prevent.

The template registry now keeps both, and `/api/tasks/:id/diagram` serves the
shared layout with live node state overlaid: the same ranks, badges and loop
budget the CLI prints and the Playground draws.

It **refuses** for a task pinned to a hard-coded template rather than improvising.
Those have no IR, and laying one out anyway would mean guessing at what the run
actually does. A 409 that explains itself beats a diagram nobody can trust.

### The Code and Diagram panes (RF-EVO-171, RF-EVO-172)

Studio could run a `.roflock` workflow without ever showing it. It now shows
both halves of the Code | Diagram pairing, and both come from the daemon rather
than being reconstructed in the browser: the source is the file on disk — a
regenerated one could disagree with what the operator is editing — and the
diagram is the shared layout rendered by `graph-ui`.

`toSvg` moved the drawing into `graph-ui` as a **string** rather than a React
component, and the Playground's own renderer was deleted rather than left
alongside it. Two renderers is the divergence that package exists to prevent, and
the first attempt at this shipped with exactly that — corrected in the following
commit. A string keeps `graph-ui` framework-free and makes the drawing assertable:
that both the happy path and the failure route appear is a test, not something
eyeballed.

A task pinned to a hard-coded template has no IR and no source, and the view says
so rather than drawing something plausible.

### Deliberately not done

`apps/web`'s `GraphRunView` — 582 lines of working operational UI, with provider
and model display, attempt counts and failure routes — is untouched, and still
rendered above the new panes. The migration plan's Stream I is explicit that
working operational screens are not rebuilt until the shared contracts are ready.
Those contracts now exist and are proven; replacing the view is a later change
with its own review, and doing both at once would mean a rewrite whose regressions
nobody could isolate.

The remaining Studio work is interface polish on tested foundations: the Run and
Events pane (RF-EVO-173), Evidence view wiring to `explainRun` (174 — a route
already exists), approval inbox integration (175 — a route already exists), driver
and permission display (176), pause/stop truthfulness in the UI (177), and
reconnect handling (178).

## 23. R10 outcome — Studio complete

All six outstanding Studio tickets landed, plus the end-to-end proof (179). The
pattern across them is worth recording, because it repeated with no exceptions:
in every case the runtime already knew the truth and the interface did not.

**RF-EVO-173 — the halt nobody could see.** A turn that was billed and whose
result was never observed halts the run under ADR-010, because re-running it may
pay twice and skipping it may discard finished work. The reason reached the
browser inside the node's `outcome` string; the graph draws nodes by state, so
nothing rendered it. An operator saw a stopped task, no explanation, and no sign
a decision was waiting on them — a halt that blocks the run and hides its own
cause. The projection now carries the condition as a fact, decided by the same
predicate the orchestrator halts on against the same invocation rows. Matching
the halt message was rejected: it would make a warning about money depend on
wording nobody would keep stable, the mistake already made once with a
regex-based permission guard (§19).

**RF-EVO-174 — evidence, gaps included.** The Evidence route rendered the
bundle, which answers "what was recorded?" rather than "why should I believe
this is safe?". The difference between those questions is entirely the missing
links. `explainRun` now reaches the UI through a `/chain` endpoint kept separate
from the bundle. The panel also had to be defended against its own payload: it
threw on a response without `steps` and took the whole Evidence page down with
it — the gap reporter destroying the diff, the bundle and the ledger. A chain
that cannot be read reports itself as unverified rather than as an empty,
clean-looking chain.

**RF-EVO-175 — already done.** The approvals route approves, rejects and grants.
The ticket needed verification, not work. Recorded so the next reader does not
rebuild it.

**RF-EVO-176 — authority, not just identity.** The live view named provider,
model and effort and said nothing about what the turn could do.
`permissionProfileId` had been travelling in the projection and declared in the
web app's own types the whole time, unrendered. Phrased as consequence ("cannot
change your code") rather than setting ("read-only"), and absent means absent —
defaulting to the read-only wording would reassure about a restriction nothing
confirmed was applied.

**RF-EVO-177 — stop.** "Force stop" was titled "Kill the active process
immediately". `stopIsConfirmable` already encoded the truth and was consumed
only by conformance. The daemon now reports the _weakest_ cancellation across
shipped drivers, derived from them rather than hard-coded: taking the best case
would hide the caveat on the runs that need it, and freezing the current floor
would leave the UI lying the other way once a provider can confirm a remote stop.

**RF-EVO-178 — a view that stopped being live.** `stream()` had no `onerror` at
all, and the shell set "Connected" once and never revised it, so a dead stream
kept displaying pre-drop state under a label claiming it was current. A stalled
run read as a running one. Transient and terminal drops are now distinguished,
recovery clears the warning, and a reconnect refetches — EventSource replays
nothing it missed, so without that the label would go back to "Connected" over
stale data.

**RF-EVO-179 — the language actually runs.** A compiled template that fails to
bridge falls back to the built-in. That is correct for robustness and is also
how an authored change could vanish silently. The test asserts on values an
author changed, read back from the graph the runtime would execute; its first
draft failed exactly that way, which is the failure it exists to catch.

**Known limit, unresolved.** `GraphMode` is a closed union of the five built-in
workflow ids. A user can change what `bug_fix` means by editing
`workflows/bug_fix.roflock`, and that edit reaches execution (179). A user
cannot yet author a _new_ workflow under a new name and run it: task creation
validates against that union, and `loadWorkflowTemplates()` is called with no
argument in `server.ts`, so a run cannot be pointed at another directory.
Widening this is a real piece of work — schema, task creation, version pinning —
not a rename, and it is not claimed as done.

**Verification at this point.** Build, typecheck and lint exit 0; 834 tests pass,
from a 432-test baseline. Live driver conformance (43 tests) passes against the
three real CLIs but stays opt-in behind `ROFLOCK_LIVE_DRIVER_TESTS=1`, so a green
suite should not be read as evidence the real CLIs were exercised.

**Not verifiable by me.** Every Studio claim above is behavioural, asserted
through testing-library. Visual design — layout, hierarchy, whether these panels
read well beside each other on a real screen — is not something I can check, and
none of it has been looked at by a person.

---

## 24. Post-R10 launch UI — Roflock and the isolated Playground

RF-EVO-180 completes the visible product rename in Studio while preserving the
wire headers, persisted paths, package namespace, and other compatibility
contracts listed in §12. Export filenames and operator-facing copy now say
Roflock; compatibility identifiers remain deliberately unchanged.

The Playground has a responsive standalone layout and a production build rooted
at `/play/`. Studio links to it only when `VITE_PLAYGROUND_URL` is an absolute
HTTP(S) URL. Production has no same-origin fallback: if the variable is absent
or invalid, the link is hidden so browser-only code cannot accidentally inherit
the daemon session and local API origin.

Verification: Web and Playground tests, targeted typechecks, full build, browser
production previews for Studio and `/play/`, and `git diff --check`. The public
deployment itself remains an operator action; the repository produces the static
artifact but does not claim that a domain has been deployed.

---

## 25. Public-alpha correction — immutable workflow snapshots

RF-EVO-181 corrects the task pinning claim recorded during R4/R5. A compatibility
version such as `bug_fix@3` identifies the runtime schema generation, but it does
not uniquely identify mutable `.roflock` template contents. Resolving that label
through the current registry could therefore change an existing task's graph and
semantic hash after an edit or daemon restart.

Migration 035 adds one immutable workflow snapshot per task. New task creation
stores the authored source, canonical Graph IR, exact lowered `WorkflowGraph`,
semantic hash, and a SHA-256 integrity hash in the same SQLite transaction as the
task. Runtime, graph, and diagram reads prefer that snapshot; corruption fails
closed instead of falling back to the current registry. Invocation identity now
uses the semantic hash carried by the graph actually loaded, not a graph with the
same display ID found in mutable registry state.

Databases upgraded from earlier builds cannot reconstruct source that changed
before this migration existed. Their tasks are frozen once at first upgraded
boot: v1/v2 tasks retain hard-coded historical graphs, while current-version
tasks retain the last semantics resolvable during that boot. This limitation is
explicit and does not affect tasks created after migration 035.

Verification covers repository immutability and cascade deletion, source/IR/graph
capture through the task API, template mutation after task creation, snapshot
integrity failure, and one-time upgrade backfill. Database tests pass 58/58;
targeted daemon snapshot/template/diagram tests pass 18/18. The full daemon suite
passes 183 non-listener tests in the sandbox, and the seven preview-listener
tests pass outside it; the three sandbox failures are the known local-listener
restriction rather than product failures.

---

## 26. Public-alpha correction — authored semantics reach execution

RF-EVO-182 closes the semantic-loss cases left by the original Graph IR bridge.
`WorkflowGraph` nodes now carry the authored agent objective, exact deterministic
check/action command, and human approval title/decision contract. The
orchestrator includes objectives in the specific node prompt, selects an authored
check unless the task has an explicit override, executes command actions through
the argv-based command runner without a shell, and emits the authored human gate
metadata before waiting for a decision.

The bridge now fails closed for semantics the runtime cannot yet represent:
model-call output schemas, agent context/structured-output policies, node
timeouts, non-command action drivers, action args/effects without an enforceable
approval mapping, non-command/test checks, check args, and human gates other than
plain approve/reject. These inputs previously risked compiling into a graph that
quietly did something else.

The compiled built-in plan-review node is now treated as the human node written
in source; it no longer invokes an extra model reviewer before asking for plan
approval. Legacy hard-coded graph versions have no authored human metadata and
retain their historical reviewer path. Daemon shutdown also ignores late
background completions after SQLite closes, preserving the existing restart
contract without unhandled database errors.

Verification: graph-core 11/11, graph-runtime 87/87, and daemon 186/189 pass in
the sandbox. The remaining three are the preview listener restriction and the
same review-app package passes 7/7 outside the sandbox. Tests cover semantic
source differences, action lowering, custom-human rejection, authored-command
selection, approval rejection, and forced-restart recovery.

---

## 27. Public-alpha correction — arbitrary workflow IDs

RF-EVO-183 removes `GraphMode` from the new-task execution boundary without
widening the historical compatibility table. The template registry can contain
any workflow ID, `graphVersionId` can version that stable string, and
`resolveWorkflowGraph` resolves its current compiled graph. `GraphMode` remains
appropriate for built-in recommendation and v1/v2/v3 hard-coded history only.

`availableWorkflowGraphs()` merges current compiled templates with built-in
fallbacks and includes custom entries. `/api/workflows` now uses that list, so
Studio's existing data-driven selector exposes arbitrary workflows rather than
silently hiding them. Task creation resolves the selected registry entry and
stores its source, IR, and executable graph snapshot; all later execution and
diagram reads use that pin.

Verification includes a non-built-in `release_train.roflock`: it is loaded,
listed by the API, selected for task creation, versioned as `release_train@3`,
and persisted with an executable graph whose ID is `release_train`. Targeted
workflow/template and API tests pass 13/13, with graph-core and daemon typechecks
clean. Historical task resolution remains unchanged.

---

## 28. Public-alpha correction — AgentDriver is the production seam

RF-EVO-184 moves production role invocation from direct
`ProviderAdapter.invoke()` calls to `AgentDriver.start()`. The daemon provider
registry now owns a driver for every registered adapter, including custom
OpenAI-compatible connections. `RoleRoute` carries that driver, and the
orchestrator consumes only driver events for output, reasoning, tool activity,
usage, liveness, process lifecycle, and final outcome. The adapter remains on
the route temporarily for writer capability compatibility; it is no longer the
execution contract.

The migration preserves the stable idempotency key as the driver invocation
identity and does not widen authority while crossing the compatibility wrapper.
The exact runtime `allowedPaths` and command permission are forwarded unchanged,
and write intent is explicit rather than guessed from prompt words. This avoids
both a security regression (turning a narrow path list into the whole worktree)
and a correctness regression where a read-only prompt such as “do not modify
files” was mistaken for a write request. Per-run spawn callbacks retain crash
reconciliation, and adapter heartbeats remain driver liveness events so quiet
but healthy turns do not hit the idle watchdog.

Verification: provider-core wrapper tests pass 22/22; the focused daemon
integration set passes 59/59, including the walking skeleton, authored
workflows, routing/failover, provider timeout, unknown-outcome protection,
cancellation, and forced-restart recovery. The full daemon suite passes 187/190
inside the sandbox; the three listener-denied cases belong to the preview
package, whose complete test file passes 7/7 outside the sandbox. Package
typechecks are clean. Durable driver lifecycle work remains outside RF-EVO-184
and is recorded separately in §29.

---

## 29. Public-alpha correction — durable driver lifecycle

RF-EVO-185 makes session, resume, and cancellation claims durable and specific
to the driver that actually executes a turn. Migration 036 extends invocation
records with driver identity, native session ID, resume parent, cancellation
capability, and the exact interruption result. A started event persists its
session immediately; later attempts of the same task and workflow node call
`driver.resume()` only when the driver claims resume and an earlier invocation
has a known terminal outcome. `OUTCOME_UNKNOWN` remains excluded, so session
support never becomes a route around ADR-010's no-duplicate-billing rule.

Active driver turns are tracked per task and per stable invocation key, including
parallel turns. Stop, cancel, and force-terminate invoke every selected active
driver, persist each returned guarantee, and return the weakest aggregate
capability. Only `remote-confirmed` can produce `stopped: true`; a local process
signal remains explicitly unconfirmed. A runtime bound also prevents an
`interrupt()` result from raising the capability the driver declared before the
turn. The task-specific cancellation endpoint and Studio warning use that live
selection rather than the global set of shipped drivers. When no harness turn is
active, Studio says scheduling can stop but does not invent an external stop.

End-to-end tests inject a resumable driver while an adapter is configured to
throw if invoked. A known failed writer attempt stores `session_41`; its retry
reaches `driver.resume()`, writes the verified change, and records the resume
parent without touching the adapter. A separate blocked turn proves that the
task stop endpoint invokes the selected driver, returns its
`remote-confirmed` result, and stores the interruption JSON. Database tests pass
60/60, provider-core tests 27/27, focused lifecycle/recovery daemon tests 21/21,
and the full Studio suite 93/93. The full daemon suite passes 191/194 inside the
sandbox; all seven preview tests, including its three listener-denied cases,
pass outside it. Package typechecks are clean.

---

## 30. Public-alpha correction — semantic non-collapse proof

RF-EVO-186 closes the last workflow-correctness proof at the task/API boundary.
An integration fixture registers `semantic_pin.roflock`, creates a task, changes
both its agent objective and deterministic check command, reloads the registry,
and creates a second task through the same API. Both tasks deliberately share
the compatibility label `semantic_pin@3`; that label is therefore proven not to
be mistaken for semantic identity.

The stored source, canonical semantic hash, executable graph integrity hash,
agent objective, and check operation differ between the two task snapshots.
After the registry mutation, runtime resolution of the first task still returns
its original objective and command while current registry resolution returns the
second graph. The first task's executable semantic hash remains bound to its
snapshot rather than the mutable registry. Combined authored-workflow and API
snapshot tests pass 14/14, with daemon typecheck clean.

---

## 31. Public-alpha runtime CLI — authored run start

RF-CLI-001 adds the first runtime command without creating a second execution
path. `roflock run <workflow.roflock> --repo <path> --brief <text>` reads the
exact source, authenticates to the loopback daemon using its local session file,
registers the repository idempotently, and calls the daemon runtime API. The API
compiles with the public language frontend, checks executable Graph IR, bridges
through `graphIrToWorkflowGraph`, stores source, IR, and executable graph as one
immutable task snapshot, then starts the existing `Orchestrator`. The response
contains stable task and graph-run IDs plus the semantic hash.

CLI-created runs explicitly set `allowUncontracted: true`; the task and response
retain the `legacy_uncontracted` warning instead of inventing or silently
authorising a Change Contract. Invalid source fails before task creation. Source
larger than 1 MiB fails closed. The runtime profile remains daemon-owned:
`ROFLOCK_FORCE_FAKE=1` selects the existing clearly labelled simulation path,
while a normal daemon uses its configured AgentDrivers. JSON output is available
on `run`; the shared JSON/exit-code contract for all remaining runtime commands
is still RF-CLI-005.

Targeted verification covers repository registration deduplication, explicit
uncontracted acknowledgement, invalid-source rejection, immutable source and
semantic snapshot persistence, authenticated API requests, exact-source
forwarding, human output, JSON output, and exit-code mapping. CLI tests pass
39/39, database tests pass 60/60, and the runtime/diagram/walking-skeleton set
passes 12/12. The full daemon suite passes 194/197 inside the sandbox; its only
three failures are listener-denied preview cases, and the complete preview file
passes 7/7 outside the sandbox. Daemon, database, and CLI typechecks are clean.

---

## 32. Public-alpha runtime CLI — durable inspection

RF-CLI-002 stabilises run inspection at the daemon boundary and adds
`roflock status <run-id>` plus `roflock events <run-id>`. Status no longer
exposes a nullable raw SQLite row: it returns camel-cased run identity,
timestamps, blocked detail, and node-state counts, or an explicit 404. Events
are read from the append-only `EventStore`, return parsed typed envelopes, and
support `--after <sequence>` so operators and harnesses can resume consumption
without replaying the complete history. An invalid cursor fails closed.

Both commands authenticate through the same local session contract as `run`.
Human output stays compact; `--json` emits the exact projection or event array
without explanatory text on stdout. Tests prove stable status identity, parsed
event payloads, ordered sequence/cursor behavior, missing-run handling, JSON
round trips, and CLI request construction. The focused CLI inspection set
passes 3/3 and runtime API tests pass 2/2, with daemon and CLI typechecks clean.

---

## 33. Public-alpha runtime CLI — run-scoped control

RF-CLI-003 adds `roflock pause`, `resume`, and `cancel` against stable run IDs.
The daemon resolves the run to its task but refuses to control a historical run
after a newer run exists for that task. Pause and cancel continue through the
existing durable `ControlCommandRepository` and `Orchestrator.control()` path;
cancel therefore invokes the AgentDriver selected for each active turn and
returns its bounded interruption capability rather than claiming every stop was
remote-confirmed.

Resume now shares the same guarded start path used by Studio. This also fixes
the older task-level `/resume` route, which previously recorded a no-op control
command and left the task paused. An active in-memory scheduler is resumed
without creating a second graph run; restart recovery creates a continuation
only through the existing start semantics. Human CLI output distinguishes a
remote-confirmed stop, an unconfirmed capability, and the absence of an active
provider turn. JSON preserves the daemon result unchanged.

Tests cover all three exact run endpoints, pause state, same-run resume,
cancellation, truthful unconfirmed output, conflict exit mapping, missing IDs,
and rejection of historical-run control. Focused CLI control tests pass 5/5;
the runtime API, restart recovery, cancellation, and production driver lifecycle
set passes 9/9, with daemon and CLI typechecks clean.

---

## 34. Public-alpha runtime CLI — explicit approvals

RF-CLI-004 adds four deliberately separate commands: `approvals` lists pending
requests (optionally filtered by run or task), `approval <id>` shows the exact
structured action and human rationale, and `approve <id>` / `reject <id>` decide
exactly one named request. Listing or inspecting pending work exits with the
documented blocked code, making approval waits visible to scripts without
turning observation into consent. JSON output preserves the complete request,
including paths, command preview, destination, risk, state hash, and fingerprint.

The daemon now exposes single-request inspection and rejects unknown IDs. It
also rejects a second decision for an already settled request instead of
returning a misleading success after a no-op update. The pre-existing grouped
approval endpoint remains available to Studio, but the CLI intentionally does
not call or alias it. Tests prove run filtering, full action inspection,
single-ID approve and reject paths, blocked exit behavior, missing-ID rejection,
and decision immutability. Focused CLI approval tests pass 5/5; the walking
skeleton, approval reuse, and restart-recovery set passes 9/9, with daemon and
CLI typechecks clean.

---

## 35. Public-alpha runtime CLI — JSON and process semantics

RF-CLI-005 makes `--json` and process exit status one automation contract across
run launch, inspection, events, controls, and approvals. Successful commands
write only their JSON value to stdout. Usage, connectivity, authentication, API,
and runtime errors write one JSON object to stderr with `error.message`, optional
daemon code and HTTP status, plus the exact `exitCode`; scripts never need to
parse human prose or risk diagnostics contaminating a JSON pipeline.

Run status is state-aware: completed/running is `0`, invalid input or unknown
identity is `2`, configuration/authentication is `3`, failed/rejected is `4`,
paused or waiting for a human is `5`, cancelled/stopping or an unclassified
process interruption is `6`, and interrupted runs with provider, setup, or
ambiguous external-work detail are `7`. Starting and control commands return
`0` when accepted; listing or inspecting a pending approval returns `5`.

The output-contract matrix covers every run-state class, daemon start failure,
HTTP metadata, JSON usage failures, and command-level JSON error wiring. The
full CLI suite passes 67/67 with typecheck clean.

---

## 36. Public-alpha runtime CLI — owned daemon lifecycle

RF-CLI-006 adds `roflock daemon start`, `status`, and `stop`. Start first probes
the configured loopback endpoint: a healthy Roflock daemon is reported as
external and reused without spawning or claiming it. Otherwise the CLI launches
the packaged/built daemon entry as a detached local process, keeps stdout/stderr
in the local data directory, waits for health plus session readiness, and writes
a mode-`0600` ownership record. No account, hosted API, or Cloud control plane is
consulted. Owned mode suppresses the token-bearing browser launch URL and forces
its daemon log to mode `0600`; the authenticated session stays in its existing
mode-`0600` file rather than being copied into logs.

Stopping is intentionally stronger than trusting a PID file. The CLI gives its
child a random ownership nonce; the daemon exposes only its SHA-256 identity and
only from the authenticated runtime-info endpoint. Stop requires the active
process, endpoint, owner record, and authenticated identity to agree before it
sends SIGTERM. A missing record, external daemon, PID reuse, stale/mismatched
identity, or unreachable ownership endpoint is a refusal—not permission to kill.
The daemon now handles SIGTERM/SIGINT by closing Fastify and SQLite cleanly.

Unit tests prove spawn/connect distinction, owner-file permissions, ownership
verification, graceful stop, mismatch refusal, missing-artifact errors, and JSON
command behavior. The daemon ownership boundary test proves the identity is not
present on unauthenticated health. A real built-artifact smoke test on isolated
loopback port 4328 reported `owned`, stopped through SIGTERM, and then reported
`stopped`. Its session and daemon log were both mode `0600`, and the log contained
no token-bearing launch URL. The full CLI suite passes 73/73, and daemon/CLI
typechecks are clean.

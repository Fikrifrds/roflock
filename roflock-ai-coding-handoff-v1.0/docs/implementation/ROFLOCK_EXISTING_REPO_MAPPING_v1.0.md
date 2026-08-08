# Roflock Existing Repository Mapping v1.0

**Purpose:** Prevent AI coding from discarding valuable existing implementation.

This is a planning map. The coding harness must verify it against the local checkout before modifying code.

---

## Classification

- **KEEP** — architecture and purpose remain aligned.
- **ADAPT** — retain implementation, change interface/terminology.
- **GENERALIZE** — retain concept/behavior, remove RoleFlock-specific constraints.
- **ADD** — new Roflock capability.
- **RETIRE LATER** — compatibility remains until replacement is proven.

---

| Current package/area | Classification | Target role in Roflock | Key rule |
|---|---|---|---|
| `graph-core` | ADAPT + GENERALIZE | legacy runtime graph compatibility, templates, validation migration | Do not delete before Graph IR bridge is complete |
| `graph-runtime` | KEEP + HARDEN | one canonical execution runtime | No second runtime |
| `contracts` | KEEP + EVOLVE | shared runtime/API contracts | Version public contracts |
| `agent-events` | KEEP + CONVERGE | driver/runtime agent event model | Avoid duplicate event taxonomies |
| `approval-engine` | KEEP | typed human authority | Expand to generic human nodes |
| `policy-engine` | KEEP | permissions/effects/budgets | Model never controls policy |
| `repository-runtime` | KEEP | Git/worktree/diff/leases | One-writer remains first-class |
| `command-runner` | KEEP | deterministic action execution | Do not turn into generic agent tool |
| `verification-runner` | KEEP + ADAPT | native check runner | Map to Roflock `check` |
| `evidence` | KEEP + GENERALIZE | artifacts/provenance/evidence | Preserve existing depth |
| `change-contracts` | KEEP + GENERALIZE | coding Outcome Contract/profile | Do not throw away |
| `change-passport` | KEEP + GENERALIZE | portable evidence bundle | Can remain a coding-specific export |
| `context-compiler` | KEEP | invocation context builder | Driver formatting separated |
| `role-protocol` | GENERALIZE | coding authority profile + generic RoleId bridge | Preserve current enforcement |
| `role-recommender` | KEEP / CODING PACK | role/profile recommendation | Not universal Graph IR semantics |
| `provider-core` | ADAPT | `driver-core` compatibility path | Preserve capability/process logic |
| `provider-codex` | ADAPT | Codex AgentDriver | Existing code is starting asset |
| `provider-claude` | ADAPT | Claude AgentDriver | Existing code is starting asset |
| `provider-cursor` | ADAPT | Cursor driver if stable | Do not promise unsupported capabilities |
| `provider-custom` | ADAPT | custom HTTP/compatible driver | Keep BYOK/local support |
| `usage-ledger` | KEEP | cost/usage | Distinguish actual/estimated |
| `database` | KEEP + MIGRATE | local durable store | Explicit migrations |
| `run-control` | KEEP + HARDEN | pause/stop/cancel/recovery | Truthful cancellation |
| `secret-store` | KEEP | secret abstraction | Never log secrets |
| `observability` | KEEP | logs/traces/runtime truth | Unknown stays unknown |
| `test-support` | EXPAND | fake driver/test repo/fault injection | Crucial for migration |
| `apps/daemon` | KEEP + EVOLVE | local runtime/API host | No browser shell execution |
| `apps/web` | EVOLVE | Roflock Studio | Preserve working operational UI during transition |
| `apps/cli` | EXPAND | `roflock` CLI + compatibility | Add language/runtime commands |
| hard-coded workflow modes | MIGRATE | `.roflock` built-in templates | Historical versions remain |
| `roleflock.config.example.yaml` | MIGRATE | `roflock.config...` + fallback | Compatibility |
| `ROLEFLOCK_*` env | MIGRATE | `ROFLOCK_*` + legacy fallback | No sudden break |
| `~/.roleflock` | MIGRATE | `~/.roflock` with safe migration | Never silently lose data |
| `@roleflock/*` package namespace | PHASED MIGRATION | `@roflock/*` | Do not combine with semantic rewrite |

---

# New packages / modules

## `graph-ir`

Canonical public semantic representation.

Owns:

- types/schema;
- normalization;
- semantic hash;
- compatibility version;
- IR migrations;
- IR-level semantic checks.

It does **not** own runtime state.

## `language`

Owns:

- tokenizer;
- parser;
- AST/CST;
- compiler frontend;
- diagnostics;
- formatting;
- source maps.

It does **not** execute graph nodes.

## `graph-ui` later

Shared browser-safe renderer for:

- website/playground;
- Studio;
- docs examples.

It consumes Graph IR/projected runtime state, not a private UI graph model.

## `driver-core` eventual

Can evolve from `provider-core`; do not duplicate prematurely.

---

# Existing code facts the AI should verify locally

The current `graph-core` historically has:

```text
WorkflowRole =
planner | reviewer | writer | test | verifier | accept

NodeKind =
agent | model_call | command | test | router | join |
human_approval | context_compile | evidence_aggregate
```

It also validates:

- writer count;
- accept reachability;
- bounded cycles;
- required checks;
- unsafe failure routes.

The current `graph-runtime` historically has:

- state map;
- attempts map;
- dependency readiness;
- max concurrency;
- explicit writer serialization;
- artifact role checks;
- local retry;
- typed failure edge routing;
- downstream reset after loop;
- loop iteration cap.

The current `provider-core` historically has:

- provider capabilities;
- model capability metadata;
- effort handling;
- async invocation events;
- PermissionEnvelope;
- process PID callback for recovery;
- health/capability/model discovery;
- failure/refusal classification.

These are **migration assets**, not reasons to start over.

---

# Compatibility priorities

Highest compatibility sensitivity:

1. persisted SQLite schema/data;
2. graph version identity for existing runs;
3. environment variables/config paths;
4. CLI/process recovery identifiers;
5. evidence/passport schemas users may have exported;
6. agent/provider account configuration.

Lower sensitivity:

- internal package names that were never published;
- local TypeScript helper function names;
- internal UI labels;
- documentation file paths.

The audit must determine actual external consumption before renaming package namespaces.

---

# Desired target dependency direction

```text
language
   ↓
graph-ir
   ↓
runtime-core / graph-runtime
   ↓
driver-core / command-runner / approval
   ↓
repository / evidence / policy / persistence
```

Avoid inverse dependencies:

```text
graph-ir → Studio        NO
graph-ir → Codex         NO
language → daemon        NO
runtime → parser AST     NO
driver-core → Studio     NO
```

---

# Legacy workflow compatibility

Historical tasks pinned to:

```text
direct@N
fast@N
standard@N
bug_fix@N
critical@N
```

must not silently receive new semantics.

New workflow package versions should use explicit identity/version/hash.

If migration needs to convert a legacy graph to Graph IR, conversion should be deterministic and covered by fixtures.

---

# Keep old delivery-assurance concepts

Do not delete just because names came from RoleFlock:

- Change Contract;
- Execution Plan;
- Verification Specification;
- Plan Deviation;
- Change Passport;
- independent verifier;
- repair envelope;
- role authority;
- evidence binding;
- smallest-sufficient execution.

They can become coding pack/domain semantics on top of Roflock core.

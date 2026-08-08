# Roflock — AI Coding Master Instruction

**Version:** 1.0  
**Date:** 8 August 2026  
**Target repository:** `https://github.com/Fikrifrds/roflock`  
**Mode:** Evolve the existing repository; do not rewrite it from scratch.

---

## Your mission

Evolve the existing RoleFlock-derived repository into **Roflock**, an open-source executable workflow language, compiler, governed graph runtime, and product surface for AI coding teams.

The target product is:

> **Roflock — AI coding teams as code.**

Technical definition:

> Roflock is a compiler-driven runtime for defining, running, and verifying AI coding teams through readable `.roflock` workflows, canonical Graph IR, deterministic checks, governed execution, human approval, and evidence.

The existing repository is **not legacy code to discard**. It already contains valuable and aligned implementation:

- graph definitions and validation;
- graph runtime scheduling;
- bounded retry/failure routing;
- concurrency limits;
- one-writer execution behavior;
- artifact/role gates;
- repository/worktree runtime;
- run control and restart recovery;
- approval engine;
- policy engine;
- command and verification runners;
- evidence and change passport concepts;
- provider adapters;
- usage/cost infrastructure;
- daemon, CLI, and web UI.

Your job is to **preserve and evolve these capabilities**, then place the Roflock Language + Graph IR above them as the new public authoring and semantic layer.

---

# 1. Mandatory implementation philosophy

Use this decision order for every existing component:

```text
KEEP
  ↓ if contract is too narrow
ADAPT
  ↓ if implementation is product-specific
GENERALIZE
  ↓ only if incompatible
REPLACE
```

Never choose `REPLACE` merely because writing new code is easier.

For every package touched, first answer internally:

1. What does this package already do?
2. Which behavior is still valid under the Roflock PRD?
3. Which public/internal assumptions are too RoleFlock-specific?
4. Can Graph IR be adapted into this package without replacing it?
5. What tests currently protect the behavior?
6. What compatibility risk would a rewrite create?

---

# 2. Read order before coding

Read, in this order:

1. `docs/prd/ROFLOCK_OPEN_SOURCE_PRD_v1.0.md`
2. `docs/implementation/ROFLOCK_EVOLUTION_IMPLEMENTATION_PLAN_v1.0.md`
3. `docs/implementation/ROFLOCK_EXISTING_REPO_MAPPING_v1.0.md`
4. `docs/implementation/ROFLOCK_MIGRATION_BACKLOG_v1.0.md`
5. root `AGENTS.md`
6. accepted RFCs under `docs/rfc/`
7. relevant existing RoleFlock implementation docs
8. the specific assigned ticket

Then inspect the actual code. Documents do not override reality silently; if code and docs disagree, record the discrepancy and decide via ticket/RFC/ADR.

---

# 3. Non-negotiable architecture

Target pipeline:

```text
.roflock source
      ↓
Language frontend
(tokenizer/parser/CST/AST)
      ↓
Compiler
      ↓
Canonical Graph IR
      ↓
Static + semantic validation
      ↓
Runtime adapter boundary
      ↓
Existing/evolved Graph Runtime
      ↓
┌─────────────┬─────────────────┬──────────────┐
│ AgentDriver │ Action / Check  │ Human / Gate │
└─────────────┴─────────────────┴──────────────┘
      ↓
Repository / policy / approvals / evidence / events
```

The runtime must not directly depend on syntax/AST.

The compiler must not execute workflows.

Graph IR must not contain mutable runtime state.

The visual editor must not become a second opaque source of truth.

---

# 4. Preserve these existing invariants

Do not weaken:

- every graph is validated before execution;
- graph loops are bounded;
- deterministic verification is first-class;
- writer execution is serialized for a task worktree;
- models cannot grant their own permissions;
- prompt text is not a security boundary;
- role/artifact authority is enforced outside the model;
- human approval is explicit;
- source code remains local unless the configured provider receives selected context;
- restart recovery preserves confirmed progress;
- ambiguous billable external work is not blindly repeated;
- provider capabilities are represented explicitly;
- failure classification is explicit and routes through typed semantics;
- critical execution state is observable and auditable.

---

# 5. Open-source invariant

Roflock is a true open-source-first product.

Do not add software-license gates that make self-hosted Roflock incomplete.

Never introduce:

- agent count limits;
- graph node limits;
- local/self-hosted run limits;
- repository limits;
- compiler checks available only in paid Cloud;
- stronger security validator available only in paid Cloud;
- replay/evidence restricted to paid users;
- self-hosted RBAC/audit disabled by license;
- custom providers disabled by license;
- hidden Cloud-only workflow semantics.

Commercial services may charge for actual managed infrastructure and operations, not permission to use fundamental software capability.

---

# 6. Rebrand rule

The product is **Roflock**.

However, do not perform an uncontrolled global search-and-replace.

Classify old identifiers:

### Safe to rename immediately

- README/product copy;
- package display names;
- new CLI name;
- docs headings;
- new source paths that are not persisted compatibility contracts.

### Require compatibility handling

- `ROLEFLOCK_*` environment variables;
- `~/.roleflock`;
- database path/file names;
- persisted event names;
- stored graph version identifiers;
- package names if externally consumed;
- config filenames;
- migration/version keys.

Preferred behavior during transition:

```text
ROFLOCK_*        preferred
ROLEFLOCK_*      legacy fallback + deprecation notice
```

Never make rebranding destroy an existing local installation.

---

# 7. Existing graph system: preserve, do not bypass

The current graph engine already represents:

- nodes;
- node kinds;
- dependencies;
- edges;
- typed failure conditions;
- retry budgets;
- global loop limits;
- required verification gates;
- writer flags;
- graph versions;
- validation;
- built-in workflow modes.

The target is not to create a parallel runtime.

Instead:

```text
Existing WorkflowGraph
        ↓
compatibility/adaptation layer
        ↕
Canonical Graph IR
        ↓
Evolved graph runtime
```

During migration, legacy graph versions must remain executable until an explicit compatibility decision says otherwise.

Built-in hard-coded graphs should ultimately become **workflow templates**, preferably `.roflock` sources compiled through the same public compiler path.

Do not delete legacy graph version support simply to simplify the new compiler.

---

# 8. Runtime migration rule

The current `runGraph()` semantics are valuable but too in-memory/monolithic to be the final public runtime boundary.

Evolve it incrementally:

```text
current runGraph()
      ↓
extract state contracts
      ↓
extract event emission
      ↓
GraphRun / NodeRun projections
      ↓
durable transition executor
      ↓
scheduler driven by durable state
```

Do not rewrite scheduler behavior and persistence simultaneously.

At each extraction step, old graph-runtime tests must remain green.

---

# 9. Provider → AgentDriver evolution

The existing provider abstraction already has useful capability discovery and streaming invocation behavior.

Do not discard it.

Evolve:

```text
ProviderAdapter
    ↓
AgentDriver / driver-core
```

Separate:

- provider/model metadata;
- harness/process lifecycle;
- agent run events;
- session/resume;
- cancellation capability;
- permission capability;
- usage reporting.

Codex/Claude/OpenCode are **drivers/harness integrations**, not graph semantics.

Graph IR must not depend on a specific vendor.

---

# 10. Role Protocol evolution

Preserve the existing strong concept:

> roles own authority and artifact contracts, not merely prompts.

But remove the assumption that the complete Roflock language can only use a fixed built-in role enum.

Target:

```text
RoleId = arbitrary stable identifier
RoleDefinition = capabilities + authority + artifact contracts
Coding Pack = supplies Planner / Builder / Reviewer / Verifier conventions
```

The current role protocol becomes a **coding-domain authority profile / compatibility layer**, not the universal grammar of all graphs.

Do not weaken current enforcement while generalizing identifiers.

---

# 11. Built-in workflows

Existing Direct/Fast/Standard/Bug Fix/Critical behavior is product value.

Do not delete it.

Migration target:

```text
hardcoded TS graph definitions
      ↓
reference `.roflock` workflows
      ↓
compile to Graph IR
      ↓
same runtime
```

The resulting compiled semantics must be tested against legacy behavior.

For each migrated built-in workflow:

- snapshot legacy graph semantics;
- compile the new source;
- normalize;
- compare intended nodes/edges/loop/approval semantics;
- add a compatibility fixture.

---

# 12. Commit and task discipline

Work on one atomic ticket at a time.

Default workflow:

```text
inspect
→ implement
→ targeted tests
→ broader verification
→ inspect diff
→ commit
```

Commit rules:

- one ticket = one logical commit;
- commit message begins with ticket ID;
- no `Co-authored-by` trailers;
- do not push unless explicitly instructed;
- do not mix rebranding with runtime behavior unless the ticket specifically requires both;
- keep unrelated formatting/refactors out of ticket commits.

Do not claim a milestone complete until every exit criterion is verified.

---

# 13. Required verification before each milestone completion

Run at least:

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

plus ticket-specific integration tests.

If a command is unavailable or already failing on baseline:

- record exact baseline failure;
- do not hide it;
- do not broaden the ticket unless necessary;
- prove your change did not make it worse.

---

# 14. Forbidden implementation shortcuts

Do not:

- rewrite the monorepo from scratch;
- create a second competing graph runtime;
- hard-code Roflock language semantics inside Studio;
- make UI JSON the canonical workflow format;
- make agent prompts enforce permissions;
- let agents choose protected workflow transitions without typed outcomes;
- remove graph/version compatibility just to simplify the new model;
- silently auto-upgrade persisted historical graph meaning;
- collapse deterministic checks into generic agent calls;
- create a vendor-specific Graph IR;
- introduce arbitrary `while`, classes, or unrestricted code execution into `.roflock`;
- implement Cloud-only correctness/security behavior;
- delete existing evidence/change-passport capabilities because the new PRD uses different terminology.

---

# 15. First required action: repository audit

Before implementation, create:

```text
docs/implementation/ROFLOCK_REPO_AUDIT.md
```

It must map:

- current package;
- responsibility;
- tests;
- dependencies;
- public/internal status;
- KEEP / ADAPT / GENERALIZE / REPLACE / RETIRE;
- target package/contract;
- migration risks.

Also record current verification baseline:

```bash
git status
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

Do not begin structural migration without this baseline.

---

# 16. First implementation objective

The first architectural success criterion is:

```text
a `.roflock` workflow
      ↓
compiles to Graph IR
      ↓
is validated
      ↓
adapts to/evolves into the existing runtime
      ↓
executes the same deterministic reference graph behavior
```

This must work with a fake/deterministic driver before altering real provider behavior.

Only after that vertical slice is green should built-in workflows begin moving from hard-coded TS to `.roflock`.

---

# 17. Final instruction

Do not treat the previous RoleFlock implementation as obsolete.

Treat it as the proven runtime/governance foundation from which Roflock is being extracted and generalized.

The migration principle is:

> **Preserve proven behavior. Expose it through a better public model. Generalize only where necessary. Add the language/compiler above it.**

When uncertain, prefer compatibility and evidence over architectural purity.

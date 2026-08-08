# Roflock architecture

Roflock is a language, compiler, governed graph runtime, local CLI/daemon, and
two browser surfaces for defining and supervising AI coding teams.

Its central invariant is one source pipeline and one runtime:

```text
.roflock source
      ↓ tokenizer / parser / AST
compiler + static diagnostics
      ↓
canonical Graph IR + semantic hash
      ↓ validator
Graph IR → WorkflowGraph bridge
      ↓ immutable task snapshot
existing runGraph scheduler
      ↓
┌──────────────┬───────────────────┬─────────────────┐
│ AgentDriver  │ action / check    │ human / gate    │
└──────────────┴───────────────────┴─────────────────┘
      ↓
worktree · policy · approvals · evidence · durable events
```

The compiler never executes a workflow. The runtime never parses syntax. Studio
and Playground do not invent private workflow semantics.

## Product surfaces

| Surface             | Responsibility                                                      |
| ------------------- | ------------------------------------------------------------------- |
| `.roflock` language | Human-readable workflow, roles, nodes, typed outcomes, bounded flow |
| Graph IR            | Canonical vendor-neutral semantic contract and identity             |
| CLI                 | Authoring, local runtime control, evidence, setup, health           |
| daemon              | Authenticated local API, persistence, orchestration, recovery       |
| Studio              | Local browser control surface for projects, runs, gates, evidence   |
| Playground          | Static browser-only compile/diagnose/diagram experience             |
| MCP                 | Five-tool stdio adapter over compiler and daemon                    |
| AgentDriver         | Capability-aware harness lifecycle and event contract               |

The public Playground is deliberately not a runtime surface. See
[its security boundary](security/playground-local-runtime.md).

## Source, IR, and identity

The language package tokenizes and parses source into an AST, compiles it to
Graph IR, and runs structural and semantic validation. Diagnostics have stable
codes and source spans. Graph IR contains immutable workflow meaning, not
mutable run state or provider-specific instructions.

Canonical normalization gives the IR a semantic hash. Debug information and
editor layout do not determine that identity. The runtime bridge supports the
implemented node/decision subset and fails explicitly when an IR semantic
cannot be executed faithfully; it does not silently approximate it.

When a run is created, one database transaction stores:

- exact source;
- canonical Graph IR;
- executable `WorkflowGraph`;
- workflow/version identity;
- semantic hash; and
- executable-graph integrity hash.

Later template edits cannot rewrite an existing task. Pre-snapshot historical
tasks are frozen once during migration when their exact semantics can still be
resolved.

## Runtime and scheduling

All authored and built-in workflows reach `runGraph`. The scheduler validates
every graph, respects dependencies and concurrency, serializes writers per task
worktree, applies local retry budgets, follows typed failure edges, and enforces
a global bounded-loop budget.

Durable `graph_runs`, `node_runs`, invocations, projections, and ordered events
surround the scheduler. A daemon restart marks in-flight state interrupted,
preserves confirmed completed nodes and spent loop budget, reconciles process
handles/writer leases, and resumes only when the outcome is safe to continue.
Ambiguous billable work is not blindly repeated.

Execution behavior by bridged node kind:

- agent/model nodes invoke the selected `AgentDriver`;
- check and supported action nodes use exact binary-plus-argument execution
  without a shell;
- human nodes create one explicit approval request; and
- unsupported effect, decision, schema, timeout, or driver semantics fail the
  bridge before scheduling.

## Roles, authority, and harnesses

Language roles are arbitrary stable identifiers carrying capability, access,
independence, and optional authority requirements. The coding compatibility
extension maps them to planner/writer/reviewer/verifier dispatch slots when
needed by the current coding runtime.

Provider/model selection lives outside core workflow semantics. The same source
and semantic hash can run through different role-to-driver bindings. Codex,
Claude Code, OpenCode, Cursor, and future Pi integration are harnesses behind
`AgentDriver`, never Graph IR node kinds.

Every driver reports installed/authenticated state and capabilities separately.
Cancellation uses the weakest active guarantee; only `remote-confirmed` may be
presented as certainly stopped.

## Repositories and authority

Each task uses a registered Git repository and a dedicated worktree where
possible. The runtime owns writer leases and exact allowed-path/command
envelopes. Models cannot widen their own permissions, grant approvals, select
protected transitions outside declared outcomes, or turn prompt text into
authority.

Required deterministic checks, role/artifact gates, policy, explicit human
approval, and acceptance remain separate from provider output. Evidence records
what ran, which route/model served it, source/graph identities, artifacts,
verification, usage confidence, and unresolved gaps.

## Local control plane

Studio, CLI, MCP, and optional clients use one loopback daemon:

```text
Studio ─┐
CLI ────┼─ authenticated local API ─ daemon ─ runGraph
MCP ────┤
client ─┘
```

The daemon binds to `127.0.0.1` by default, but loopback is not treated as
authorization. A mode-`0600` session file supplies the token; mutations also
require CSRF, non-local browser origins are rejected, and tokens never appear in
API URLs. `/api/control/v1` discovers the stable public-alpha local contract.

## Package map

| Area                      | Main location                                                             |
| ------------------------- | ------------------------------------------------------------------------- |
| parser/compiler           | `packages/language`                                                       |
| Graph IR/validation       | `packages/graph-ir`                                                       |
| bridge/built-in history   | `packages/graph-core`                                                     |
| scheduler                 | `packages/graph-runtime`                                                  |
| drivers                   | `packages/provider-core`, `packages/provider-*`                           |
| persistence               | `packages/database`                                                       |
| repo/worktrees/commands   | `packages/repository-runtime`, `packages/command-runner`                  |
| approvals/policy/evidence | `packages/approval-engine`, `packages/policy-engine`, `packages/evidence` |
| CLI/MCP                   | `apps/cli`                                                                |
| daemon                    | `apps/daemon`                                                             |
| Studio/Playground         | `apps/web`, `apps/playground`                                             |
| shipped workflow source   | `workflows/*.roflock`                                                     |

## Compatibility

Roflock evolved from RoleFlock. Historical graph version IDs, database filename,
wire headers, stored events, exported media types, `ROLEFLOCK_*` environment
fallbacks, and an existing `~/.roleflock` installation remain compatible where
the migration audit records them. New names prefer `ROFLOCK_*` and `~/.roflock`.

The hard-coded TypeScript graphs remain historical execution definitions for
pinned old versions. New/current built-in selection compiles the shipped
`.roflock` sources through the public compiler. There is no second runtime.

For the exact repository history and evidence behind each evolution phase, read
the [repository audit](implementation/ROFLOCK_REPO_AUDIT.md) and
[public-alpha completion plan](implementation/ROFLOCK_PUBLIC_ALPHA_COMPLETION_PLAN_v1.0.md).

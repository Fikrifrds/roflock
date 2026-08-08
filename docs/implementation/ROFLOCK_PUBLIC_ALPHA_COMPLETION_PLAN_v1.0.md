# Roflock Public Alpha Completion Plan

**Version:** 1.0

**Date:** 9 August 2026

**Status:** Active; authoritative for public-alpha readiness

**Baseline:** `5d8b69a` on `roflock-evolution-r0`

---

## 1. Purpose

R0–R10 produced the language, Graph IR, runtime bridge, durable run history,
drivers, evidence chain, Playground, and Studio panes. Those milestones describe
implemented slices; they do **not** prove that the repository is distributable
or that every authored workflow semantic reaches execution.

This plan closes that gap. It is the status authority for the public alpha and
supersedes older `done` labels wherever they conflict with the implementation or
the release gates below. Historical milestone outcomes remain recorded in
`ROFLOCK_REPO_AUDIT.md`.

Public-alpha ready means a developer can install the packed CLI outside this
monorepo, author and validate a `.roflock` workflow, run the exact pinned
semantics locally with a conforming driver, control and inspect the run, and
verify its evidence without a Cloud account.

Publishing to npm, creating a GitHub Release, deploying a public domain, and
pushing this branch remain explicit operator actions. Readiness does not claim
that those external actions have happened.

---

## 2. Reopened correctness blockers

These findings take precedence over milestone completion claims.

| Ticket     | State    | Required outcome                                                                                                                                                                                                                                                   |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RF-EVO-181 | complete | Task creation atomically stores source, Graph IR, executable graph, semantic identity, and graph integrity hash. Upgrades freeze pre-snapshot tasks once; later template edits cannot rewrite them.                                                                |
| RF-EVO-182 | complete | Runtime nodes carry authored objectives, exact check/action commands, and approval metadata. Supported commands execute without a shell; unsupported driver, schema, timeout, effect, and custom-decision semantics fail bridging explicitly.                      |
| RF-EVO-183 | complete | Registered `.roflock` templates with arbitrary IDs are discoverable through the API/Studio, create tasks, receive current version identities, and execute from immutable snapshots; built-in historical fallback remains closed and versioned.                     |
| RF-EVO-184 | complete | Production role turns execute through `AgentDriver.start`; adapters remain only for compatibility metadata/writer capability checks. Exact path/command ceilings, lifecycle PIDs, heartbeat liveness, usage, and the stable invocation key survive the seam.       |
| RF-EVO-185 | complete | Migration 036 persists driver/session/resume and interruption evidence. Known later attempts resume through the selected driver; ambiguous turns remain blocked. Task-specific stop status and control responses use the weakest active selected-driver guarantee. |
| RF-EVO-186 | complete | API-created tasks from two revisions of one workflow keep distinct source, executable graph, semantic hash, and integrity hash despite sharing the compatibility version; the earlier task remains pinned after registry mutation.                                 |

The implementation order is 181 → 182 → 183 → 184 → 185 → 186. Each ticket
must preserve the single `runGraph` runtime and pass its targeted tests before a
separate commit.

---

## 3. Distribution status

The approved source for this stream is
`ROFLOCK_CLI_DISTRIBUTION_AND_HARNESS_INTEGRATION_v1.0.md`.

| Ticket      | State    | Evidence or remaining work                                                                                                                                            |
| ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-DIST-001 | complete | The public `roflock` package bundles every internal workspace dependency and carries only Fastify plus `better-sqlite3` in its install closure.                       |
| RF-DIST-002 | complete | Package-relative `roflock` and deprecated `roleflock` bins resolve correctly; the installed CLI locates its bundled daemon from a shared output chunk.                |
| RF-DIST-003 | partial  | Version/help/check pass from a clean installed tarball on macOS; the Linux and Windows matrix remains RF-DIST-012 work.                                               |
| RF-DIST-004 | complete | Latest package smoke produced a 38-entry, 1,306,344-byte tarball with CLI/MCP bins, daemon, workflows, README/license, and no private workspace dependency.           |
| RF-DIST-005 | complete | A fresh npm install outside the monorepo passed version/help/check and ownership-proven daemon start/status/stop on port 4332; the reproducible CI gate lands in 012. |
| RF-DIST-006 | complete | `roflock doctor` verifies package/Node/Git/repository/worktree/daemon plus fresh driver auth and runnability; JSON and exit status are CI-safe.                       |
| RF-DIST-007 | complete | `roflock drivers [doctor]` reports the daemon's production driver inventory and truthful runtime capabilities.                                                        |
| RF-DIST-008 | complete | Driver text and JSON keep installed, registered/detected, authenticated, and runnable as four separate states.                                                        |
| RF-DIST-009 | complete | `roflock init` creates a credential-free four-file scaffold, is byte-idempotent, preflights all conflicts, and never overwrites user content.                         |
| RF-DIST-010 | open     | Define and test machine-readable output for automation commands.                                                                                                      |
| RF-DIST-011 | partial  | Exit constants exist; command-level mapping and public documentation are incomplete.                                                                                  |
| RF-DIST-012 | complete | GitHub-hosted OIDC publishing has no long-lived npm token, enforces tag/version identity, and follows a three-OS packed-install workflow plus full release gates.     |
| RF-DIST-013 | open     | Add and execute the alpha release checklist; actual publish remains an operator action.                                                                               |

The package strategy must be decided from a clean install, not from workspace
symlinks. Internal packages may be published together or bundled into the CLI,
but a consumer must never need this monorepo to resolve `workspace:*`.

---

## 4. Runtime CLI status

Language commands (`check`, `compile`, `validate-ir`, `hash`, and `render`) and
evidence queries exist. Runtime launch now exists; durable inspection, control,
approvals, shared output semantics, and owned-daemon lifecycle remain below.

| Ticket     | State    | Required outcome                                                                                                                                                            |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-CLI-001 | complete | `roflock run <workflow>` compiles exact source through the daemon, starts local execution, and returns stable run/task IDs. Simulation remains the explicit daemon profile. |
| RF-CLI-002 | complete | `status` and cursor-based `events` query stable authenticated projections from durable run state and event history.                                                         |
| RF-CLI-003 | complete | Run-scoped `pause`, `resume`, and `cancel` use the existing durable control and truthful AgentDriver interruption contracts.                                                |
| RF-CLI-004 | complete | Approval list/filter/inspect commands expose exact actions; approve/reject require one explicit pending approval ID.                                                        |
| RF-CLI-005 | complete | Every runtime command has machine-readable success/error output and stable state-aware exit-code semantics.                                                                 |
| RF-CLI-006 | complete | `daemon start/status/stop` connects or manages an ownership-proven local process with no Cloud dependency or unsafe PID-only kill.                                          |

---

## 5. Harness and ecosystem status

| Ticket         | State at baseline | Evidence or remaining work                                                                                                  |
| -------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| RF-HARNESS-001 | complete          | AgentDriver scope is implemented and documented.                                                                            |
| RF-HARNESS-002 | complete          | FakeDriver and public conformance runner exist.                                                                             |
| RF-HARNESS-003 | complete          | Codex CLI integration has conformance and opt-in live validation.                                                           |
| RF-HARNESS-004 | complete          | Claude Code integration has conformance and opt-in live validation.                                                         |
| RF-HARNESS-005 | complete          | The Pi RPC/SDK spike selects process-isolated RPC, caps capability claims, and defines driver/conformance exit criteria.    |
| RF-HARNESS-006 | complete          | OpenCode driver, conformance coverage, production registry wiring, and fail-closed stored-credential detection exist.       |
| RF-HARNESS-007 | complete          | Copy-paste Codex/Claude/OpenCode MCP and shell-harness examples preserve daemon, source, and approval boundaries.           |
| RF-HARNESS-008 | complete          | Accepted RFC-002 fixes stdio/local-user trust, exact tool scope, immutable runtime reuse, and external human approval.      |
| RF-HARNESS-009 | complete          | Packed `roflock-mcp` exposes check/compile/run/status/events; protocol smoke proves no approval or rejection tool.          |
| RF-HARNESS-010 | complete          | Authenticated `/api/control/v1` discovers the stable runtime/control contract; integration guide and boundary test exist.   |
| RF-HARNESS-011 | open              | Run one workflow under two execution profiles in portability E2E.                                                           |
| RF-HARNESS-012 | complete          | Cancellation truthfulness is tested at driver and Studio wording boundaries.                                                |
| RF-HARNESS-013 | complete          | The auth guide maps shipped harness probes and ownership, BYOK scope, Pi status, secret handling, and explicit non-support. |
| RF-HARNESS-014 | partial           | Studio now fails closed on Playground URLs; the complete browser-to-local-runtime security design is still required.        |

MCP is an adapter over existing compiler/runtime/control contracts. It must not
become a second runtime or an approval bypass.

---

## 6. Product and documentation stream

| Ticket      | State    | Required outcome                                                                                    |
| ----------- | -------- | --------------------------------------------------------------------------------------------------- |
| RF-EVO-180  | complete | Visible Roflock launch UI and isolated responsive Playground; commit `5d8b69a`.                     |
| RF-DOCS-001 | open     | Documentation index and architecture overview with the one-runtime pipeline.                        |
| RF-DOCS-002 | open     | Language reference for syntax, node kinds, outcomes, loops, authority, diagnostics, and versioning. |
| RF-DOCS-003 | open     | CLI reference including install, commands, JSON, exit codes, and troubleshooting.                   |
| RF-DOCS-004 | open     | Local runtime/operator guide: configuration, data, recovery, approvals, evidence, and upgrades.     |
| RF-DOCS-005 | open     | Playground and Studio guides, including deployment and local handoff boundaries.                    |
| RF-DOCS-006 | open     | Driver authoring/conformance guide and Codex, Claude, OpenCode, Pi status.                          |
| RF-DOCS-007 | open     | Open-source contributor, governance, security-reporting, support, and release guides.               |
| RF-DOCS-008 | open     | End-to-end quick starts validated against a packed artifact and clean checkout.                     |

Documentation examples are executable fixtures where practical. A command that
has not passed package/E2E verification must not be presented as shipped.

---

## 7. Release gates

Every atomic ticket runs targeted tests. Public-alpha completion additionally
requires all of the following from a clean checkout or equivalent clean fixture:

1. `pnpm install --frozen-lockfile`;
2. `pnpm build`;
3. `pnpm lint`;
4. `pnpm typecheck`;
5. `pnpm test`;
6. `pnpm format:check`;
7. `git diff --check`;
8. CLI tarball content and clean-install tests;
9. Linux, macOS, and Windows CI for compiler/CLI/package smoke tests;
10. deterministic runtime E2E, restart recovery, and two-profile portability;
11. browser production builds for Studio and Playground;
12. automated browser smoke and accessibility checks for the public path;
13. documentation link/example validation;
14. a final audit that maps every open ticket above to a commit and exact test result.

Known baseline debt is not silently waived. The repository-wide format gate and
parallel Web test timing observed during the launch review must be fixed or
reproduced and documented before completion.

---

## 8. Completion rule

A row becomes `complete` only when code or documentation exists in the checkout,
the stated acceptance behavior has an automated test or reproducible check, and
the atomic commit is recorded in the final audit. Narrative, source-tree-only
execution, or a milestone label is not evidence by itself.

The final report will include:

- commits not pushed;
- changed packages and compatibility impact;
- exact gate results and OS coverage;
- package tarball identity;
- supported and unsupported driver capabilities;
- security boundaries and residual risks;
- operator actions still required to publish or deploy.

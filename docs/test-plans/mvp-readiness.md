# Public MVP readiness

**Date:** 27 July 2026
**Verdict:** Ready for local Verified Fix use. Not a packaged DMG / live roleflock.com deploy.

## Exit gate checklist

| Gate                                                                                  | Status                                                         |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Phase 0 / daemon acceptance suites pass                                               | Pass (`pnpm test` — 117 tests, 0 skipped)                      |
| Graph-runtime acceptance suite passes                                                 | Pass (`packages/graph-core`, `packages/graph-runtime`)         |
| Lint is a real linter, not a second typecheck                                         | Pass (`pnpm lint` → ESLint 9 flat config, 0 errors)            |
| Localhost auth + CSRF + origin                                                        | Pass — token is file-delivered (0600), never served by the API |
| Path/symlink deny + writer lease                                                      | Pass (in-memory + durable SQLite lease)                        |
| Users can install via `pnpm`, connect providers, register repo, complete Verified Fix | Pass (FORCE_FAKE or live CLIs)                                 |
| Privacy claims match data flow                                                        | Pass (first-run gate + Privacy page)                           |
| Cost/quota labels truthful                                                            | Pass (actual vs shadow, never summed)                          |
| Local export/delete                                                                   | Pass                                                           |
| Crash recovery docs                                                                   | Pass (`docs/crash-recovery.md`)                                |
| Benchmark recorded without marketing claims                                           | Pass (`docs/benchmarks/baseline.md`)                           |
| Threat model                                                                          | Pass (`docs/security/threat-model.md`)                         |
| Web UI has automated coverage                                                         | Pass (16 tests: session handling, shell, routes, graph view)   |
| Public site copy                                                                      | Draft markdown in `docs/public/` (deploy deferred)             |
| Installer DMG                                                                         | Deferred (`pnpm start`)                                        |

## M8 graph runtime status

Implemented and covered by tests:

- Node kinds: agent, model call, command, test, router, join, human approval, context compile, evidence aggregate
- Typed conditional edges (`on_fail`, `on_needs_changes`, `on_timeout`, `on_provider_error`, `on_budget_exhausted`)
- Failure classification (`classifyFailure` / `NodeFailure`) routing to the matching edge
- Bounded local retries per node plus a graph-level `maxLoopIterations` cap
- Concurrency limit, with writers additionally serialised — never two writers per worktree
- Immutable graph versions (`bug_fix@1`); a task is pinned at creation and a retired version fails loudly
- Validator rejects: parallel writers, duplicate ids, unconditional and unbounded cycles, missing or non-terminal accept, invalid state references, pass paths that bypass a required check, incompatible fallbacks (failure → accept, needs-changes → non-writer)
- Restart recovery: an interrupted run keeps its completed nodes and worktree, and resumes from there
- Read-only run visualisation (`GET /api/tasks/:id/graph` + Run graph panel on Task detail)

Not implemented: user-authored graphs. Templates are the only graph source, which is why the validator runs against fixed shapes.

## Honest remaining limits

- Writer prefers Cursor Agent CLI (`agent -p --force`) when installed and authenticated; otherwise produces a leased `ROLEFLOCK_FIX.md` artefact under a permission envelope. Post-write path checks keep changes inside the worktree.
- Live Claude/Codex planner/verifier runs when discovered and not force-faked.
- The verifier rejects on two grounds: an empty worktree diff, and its own `VERDICT: NEEDS_CHANGES` line. A reply with no parseable verdict is inconclusive rather than a rejection, since the required deterministic check already gates acceptance.
- Roles are an ordered provider+model list per role, editable at `/roles`. A candidate that reports exhausted quota, an unknown model, or a dead session is parked on a cooldown and the router moves to the next entry; the substitution is recorded as evidence and in the audit log.
- Cursor Agent reports an unusable model on stderr while exiting 0. The adapter inspects output as well as the exit code, so a mistyped model id fails over instead of producing an empty run that reports success.
- Effort is expressed differently per provider — Cursor encodes it in the model id, Claude and Codex take it as a separate setting — and levels above what a CLI documents are clamped rather than forwarded.
- Vendor account-wide quota dashboards are not scraped; Providers show RoleFlock local usage + CLI account identity + vendor usage buttons.
- Provider discovery shells out to the real CLIs. Results are cached for 15s; a cold probe on a machine with all three installed still takes a few seconds.
- Multi-user hosts: a second OS account cannot reach the API without the token file, but nothing sandboxes the provider CLIs themselves.

## First run

See `docs/product/verified-fix-onboarding.md`.

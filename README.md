# RoleFlock

**RoleFlock by Mlola** — local-first control plane for governed multi-agent software engineering.

- Public site: https://roleflock.com
- Local UI (dev): http://127.0.0.1:5173
- Local daemon: http://127.0.0.1:4178

## Status: reliable local beta

See [`docs/test-plans/mvp-readiness.md`](docs/test-plans/mvp-readiness.md) for the Public MVP exit-gate checklist.

Implemented and covered by automated tests:

- Verified bug-fix flow (planner → approval → writer → verification → verifier → accept)
- Per-role provider and model choice with automatic failover when a quota runs out
- Required real verification (`npm test` or a custom argv command); a live run fails closed when neither exists
- Direct / Fast / Standard / Bug Fix / Critical workflow modes, pinned to an immutable graph version
- Graph runtime: typed failure edges, bounded retry loops, concurrency limits, one writer per worktree
- Read-only run graph on Task detail, showing live node state and failure routes
- Folder picker + custom project names
- Approval inbox, grant reuse, knowledge base UI
- Providers page with real CLI discovery + account/login/switch + local usage
- Evidence, context inspector, export/privacy/backup/delete
- Daemon restart recovery that resumes completed nodes — [`docs/crash-recovery.md`](docs/crash-recovery.md)
- Localhost-only bind, file-delivered session token, CSRF, origin allow-list, no shell endpoint
- Version/update check without repository data

Manual checklist: [`docs/test-plans/manual-test-checklist.md`](docs/test-plans/manual-test-checklist.md)  
Verified Fix first run: [`docs/product/verified-fix-onboarding.md`](docs/product/verified-fix-onboarding.md)  
Threat model: [`docs/security/threat-model.md`](docs/security/threat-model.md)

## Setup

Requires Node 24+ and pnpm 11+.

For live agent runs, install and authenticate at least one writer-capable CLI:
Codex or Cursor Agent. The Providers page reports a missing CLI as unavailable;
RoleFlock no longer substitutes a generated markdown file for a live code change.

```bash
pnpm install
pnpm build
pnpm lint       # ESLint 9 flat config
pnpm typecheck
pnpm test
```

## Run locally

```bash
# Terminal 1 — daemon (binds only to 127.0.0.1:4178)
pnpm dev

# Terminal 2 — Vite UI
pnpm dev:web
```

**Open the URL the daemon prints**, not a bare `localhost`:

```
Open the UI:    http://127.0.0.1:4178/?rft=<token>
Vite dev UI:    http://127.0.0.1:5173/?rft=<token>
```

That `rft` parameter is the one-time handoff of the session token. The UI stores it
and strips it from the address bar; after the first visit a plain
`http://127.0.0.1:5173` works. Lost the link? Run `pnpm url`.

The token lives in `~/.roleflock/session.json` (mode `0600`) and is stable across
restarts, so the link keeps working. `ROLEFLOCK_ROTATE_TOKEN=1 pnpm dev` mints a new
one and invalidates the old. The daemon never serves the token over HTTP — loopback is
shared with every other OS account on the machine, so the file mode is what keeps a
second local user out.

State: `~/.roleflock/roleflock.db` (override with `ROLEFLOCK_DATA_DIR`).

If port `4178` is occupied, choose another one consistently for daemon and Vite:

```bash
ROLEFLOCK_PORT=4312 pnpm dev
ROLEFLOCK_PORT=4312 pnpm dev:web
```

**Important:** restart both daemon and web after pulling new code. If Start fails, the UI shows the error text.

## Suggested first test path

1. Projects → Choose… → register a Git repo → optional display name
2. New task → Verified Bug Fix → Send to flock
3. Task detail → Start
4. Approve confirmation when reviewer asks
5. Accept when verification finishes
6. Open Evidence + Providers

Use `ROLEFLOCK_FORCE_FAKE=1 pnpm dev` only for a deterministic UI/workflow
simulation without live CLIs. The UI and exported evidence label it as
**simulation**; its scripted output and `simulation-check` are not proof that a
repository fix works.

## Roles and models

Open **Roles** to set which provider and model runs each role. Each role is an
ordered list: RoleFlock uses the first candidate that is healthy and not out of
quota, and falls through to the next when one refuses.

Shipping defaults:

| Role           | Preference                      | Falls back to                                                        |
| -------------- | ------------------------------- | -------------------------------------------------------------------- |
| Planner / lead | Cursor · `claude-opus-5-high`   | `gpt-5.6-sol-high`, then Codex `gpt-5.6-sol`, then Claude CLI `opus` |
| Executor       | Cursor · `cursor-grok-4.5-high` | `claude-opus-5-high`, then Codex `gpt-5.6-sol`, then `composer-2.5`  |
| Reviewer       | Cursor · `gpt-5.6-terra-medium` | `claude-opus-5-low`, then Codex `gpt-5.6-terra`                      |
| Verifier       | Cursor · `gpt-5.6-terra-high`   | `claude-opus-5-medium`, then Codex `gpt-5.6-terra`                   |

There is no fake provider. It is not in any list and it is not even registered
unless `ROLEFLOCK_FORCE_FAKE=1` or `ROLEFLOCK_INCLUDE_FAKE=1` asks for it, so it
cannot be picked by accident. If every candidate for a role refuses, the run
**stops** and shows what each provider said.

Where a model is reachable through two providers it appears twice on purpose —
Cursor and Codex meter separately, so an exhausted plan costs the run a
provider rather than the model.

When a provider reports exhausted quota, an unknown model, or a dead session,
that provider+model is parked on a cooldown (quota 1 h, unknown model 3 h) and
the next candidate runs. The substitution is written to the task's evidence and
the audit log — it is never silent. Lift a cooldown early from the Roles page.

### When everything refuses

The task stops and shows each provider's own error text, with a link straight to
the role that needs changing. The steps that already finished are kept: the run
is left resumable, so after you pick a model that answers, **Resume the run**
picks up where it stopped instead of repeating work you already paid for.

Effort is expressed differently per CLI: Cursor encodes it in the model id
(`claude-opus-5-high` vs `-low`), while Claude Code and Codex take it as a
separate setting. Both spellings are supported, and a level above what a CLI
documents is clamped rather than forwarded.

## Notes

- **Fake provider** is omitted from the Providers UI unless `ROLEFLOCK_INCLUDE_FAKE=1`; `ROLEFLOCK_FORCE_FAKE=1` is visibly labelled simulation and never production verification.
- Claude / Codex / Cursor appear on Providers with `ready` or `missing` based on PATH; login via provider auth actions.
- **Writer:** Cursor Agent or Codex edits only the leased worktree. Codex uses an explicit `workspace-write` sandbox; all non-writer Codex turns are explicitly `read-only`.
- A live run without a custom verification command or a package test script fails closed instead of accepting artefact presence as a test.
- Planner/verifier may invoke Claude/Codex when discovered and not forced fake.
- Provider discovery spawns the real CLIs and caches the result for 15s, so the Providers page does not respawn subprocesses on every poll.
- `pnpm url` reprints the launch URL; `ROLEFLOCK_ROTATE_TOKEN=1` rotates the session token.
- Public site copy (draft): [`docs/public/README.md`](docs/public/README.md), [`docs/public/privacy.md`](docs/public/privacy.md)
- Baseline benchmark: `pnpm benchmark` → [`docs/benchmarks/baseline.md`](docs/benchmarks/baseline.md)

## Safety invariants

- Browser never executes shell commands
- Daemon binds to localhost by default, and no API route hands out the session token
- No raw shell or arbitrary filesystem-read HTTP endpoints
- One writer lease per task worktree; the scheduler never runs two writers at once
- No validated graph can loop forever, or reach `accept` without its required checks
- A running task keeps the graph version it started with
- Secret/symlink escape paths denied
- Unknown billable outcomes are not auto-retried
- Token counts and costs come from the CLI or are marked unknown — never invented
- Actual and shadow cost are never presented as one bill
- Stopping a task kills its provider process and settles the task on a terminal state
- Update checks never send repository paths or contents

## Workspace

```text
apps/web          Local React control UI (routes/, components/, lib/, test/)
apps/daemon       Fastify local daemon + orchestrator
packages/*        Contracts, database, runtime, providers, approvals
docs/product      PRD + implementation plan
docs/adr          Architecture decision records
docs/security     Threat model
docs/public       roleflock.com draft copy
docs/test-plans   Exit gates + manual checklist
docs/benchmarks   Local fixture baselines
```

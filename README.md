# RoleFlock

**RoleFlock by Mlola** — local-first control plane for governed multi-agent software engineering.

- Public site: https://roleflock.com
- Local UI (dev): http://127.0.0.1:5173
- Local daemon: http://127.0.0.1:4178

## Status: ready for local testing

Phase 0 walking skeleton is implemented and covered by automated tests:

- Verified bug-fix flow (planner → approval → writer → test → verifier → accept)
- Direct / Fast / Standard / Bug Fix workflow modes
- Folder picker + custom project names
- Approval inbox + in-task approve banner
- Providers page with honest CLI discovery (Claude / Codex / Cursor / Fake)
- Evidence, usage, disclosure manifests
- Daemon restart recovery for pending approvals
- Localhost-only bind, session token, CSRF, no shell endpoint

Manual checklist: [`docs/test-plans/manual-test-checklist.md`](docs/test-plans/manual-test-checklist.md)

## Setup

Requires Node 24+ and pnpm 11+.

```bash
pnpm install
pnpm build
pnpm test
```

## Run locally

```bash
# Terminal 1 — daemon (binds only to 127.0.0.1:4178)
pnpm dev

# Terminal 2 — Vite UI
pnpm dev:web
```

Open http://127.0.0.1:5173

State: `~/.roleflock/roleflock.db` (override with `ROLEFLOCK_DATA_DIR`).

**Important:** restart both daemon and web after pulling new code. If Start fails, the UI now shows the error text.

## Suggested first test path

1. Projects → Choose… → register a Git repo → optional display name
2. New task → Verified Bug Fix → Send to flock
3. Task detail → Start
4. Approve confirmation when reviewer asks
5. Accept when verification finishes
6. Open Evidence + Providers

## Notes

- Walking skeleton uses the **Fake provider** for deterministic local runs.
- Claude / Codex / Cursor appear on Providers with `ready` or `missing` based on PATH.
- Real CLI-driven writing is scaffolded; full live CLI orchestration is next after local UI validation.

## Safety invariants

- Browser never executes shell commands
- Daemon binds to localhost by default
- No raw shell or arbitrary filesystem-read HTTP endpoints
- One writer lease per task worktree
- Secret/symlink escape paths denied
- Unknown billable outcomes are not auto-retried

## Workspace

```text
apps/web          Local React control UI
apps/daemon       Fastify local daemon + orchestrator
packages/*        Contracts, database, runtime, providers, approvals
docs/product      PRD + implementation plan
docs/adr          Architecture decision records
docs/test-plans   Exit gates + manual checklist
```

# RoleFlock

**RoleFlock by Mlola** — local-first control plane for governed multi-agent software engineering.

- Public site: https://roleflock.com
- Local runtime: http://127.0.0.1:4178

## What Phase 0 delivers

A verified bug-fix walking skeleton:

```text
Create bug-fix task
→ planner (fake/Claude)
→ reviewer confirmation
→ writer under one-writer worktree lease
→ deterministic test
→ independent verifier
→ human accept/reject
```

Durable SQLite event store, localhost-only daemon, typed approvals, usage/disclosure evidence, pause/stop/cancel controls, and orphan reconciliation on restart.

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

# Terminal 2 — Vite UI (proxies /api to the daemon)
pnpm dev:web
```

Open http://127.0.0.1:5173. The UI bootstraps the session token from `/api/runtime/info`.

State lives at `~/.roleflock/roleflock.db` (override with `ROLEFLOCK_DATA_DIR`).

## Workspace layout

```text
apps/web          Local React control UI
apps/daemon       Fastify local daemon + orchestrator
packages/*        Contracts, database, runtime, providers, approvals
docs/product      PRD + implementation plan
docs/adr          Architecture decision records
```

## Safety invariants

- Browser never executes shell commands.
- Daemon binds to localhost by default.
- No raw shell or arbitrary filesystem-read HTTP endpoints.
- One writer lease per task worktree.
- Secret/symlink escape paths are denied.
- Unknown billable invocation outcomes are not auto-retried.

## Product docs

See `docs/product/` for PRD v2.4 and Implementation Plan v1.0.

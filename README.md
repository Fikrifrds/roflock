# RoleFlock

**RoleFlock by Mlola** — local-first control plane for governed multi-agent software engineering.

- Public site: https://roleflock.com
- Local UI (dev): http://127.0.0.1:5173
- Local daemon: http://127.0.0.1:4178

## Status: ready for local Verified Fix

See [`docs/test-plans/mvp-readiness.md`](docs/test-plans/mvp-readiness.md) for the Public MVP exit-gate checklist.

Implemented and covered by automated tests:

- Verified bug-fix flow (planner → approval → writer → verification → verifier → accept)
- Optional verification command (`npm test`, custom argv, or artefact check)
- Direct / Fast / Standard / Bug Fix workflow modes
- Folder picker + custom project names
- Approval inbox, grant reuse, knowledge base UI
- Providers page with real CLI discovery + account/login/switch + local usage
- Evidence, context inspector, export/privacy/backup/delete
- Daemon restart recovery — [`docs/crash-recovery.md`](docs/crash-recovery.md)
- Localhost-only bind, session token, CSRF, no shell endpoint
- Version/update check without repository data

Manual checklist: [`docs/test-plans/manual-test-checklist.md`](docs/test-plans/manual-test-checklist.md)  
Verified Fix first run: [`docs/product/verified-fix-onboarding.md`](docs/product/verified-fix-onboarding.md)  
Threat model: [`docs/security/threat-model.md`](docs/security/threat-model.md)

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

Use `ROLEFLOCK_FORCE_FAKE=1 pnpm dev` for a deterministic first pass without live CLIs.

## Notes

- **Fake provider** is omitted from the Providers UI unless `ROLEFLOCK_INCLUDE_FAKE=1`; use `ROLEFLOCK_FORCE_FAKE=1` for deterministic orchestration.
- Claude / Codex / Cursor appear on Providers with `ready` or `missing` based on PATH; login via provider auth actions.
- **Cursor writer:** sandboxed filesystem writes under a permission envelope + writer lease — full Cursor Agent CLI loop still deferred.
- Planner/verifier may invoke Claude/Codex when discovered and not forced fake.
- Public site copy (draft): [`docs/public/README.md`](docs/public/README.md), [`docs/public/privacy.md`](docs/public/privacy.md)
- Baseline benchmark: `pnpm benchmark` → [`docs/benchmarks/baseline.md`](docs/benchmarks/baseline.md)

## Safety invariants

- Browser never executes shell commands
- Daemon binds to localhost by default
- No raw shell or arbitrary filesystem-read HTTP endpoints
- One writer lease per task worktree
- Secret/symlink escape paths denied
- Unknown billable outcomes are not auto-retried
- Update checks never send repository paths or contents

## Workspace

```text
apps/web          Local React control UI
apps/daemon       Fastify local daemon + orchestrator
packages/*        Contracts, database, runtime, providers, approvals
docs/product      PRD + implementation plan
docs/adr          Architecture decision records
docs/security     Threat model
docs/public       roleflock.com draft copy
docs/test-plans   Exit gates + manual checklist
docs/benchmarks   Local fixture baselines
```

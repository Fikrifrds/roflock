# Ready for local testing

**Date:** 26 July 2026  
**Branch:** `main` (local; not pushed unless requested)

## Automated verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm benchmark   # optional — writes docs/benchmarks/baseline.md
```

Passing coverage includes:

- Daemon boundary (localhost, auth, CSRF, origin, no shell endpoint)
- Walking skeleton bug-fix flow
- Approval persistence across daemon restart
- Repository path/symlink deny + one-writer lease
- Graph mode validation
- Provider discovery + role routing (Claude/Codex/Cursor/custom); **fake hidden** from Providers list
- Real CLI auth action endpoints (login/logout/switch where supported)
- Cursor permission-envelope write deny
- Context compiler role contracts + secret path exclusions
- Prompt injection boundary (denied paths / secret sensitivity omitted from promptBlock)
- Command-runner sandbox cwd deny + arg-array spawn (no shell injection)
- Evidence/audit/diagnostics export with redaction
- Local data backup + confirmed delete
- Version/update check offline stub (no repository data transmitted)
- Approval grants + knowledge list APIs
- Durable writer lease + stop vs force-terminate distinction
- Optional task verification command

## How to start testing

```bash
pnpm install
pnpm build
pnpm start     # built daemon (serves web dist when present)
# or
pnpm dev       # terminal 1
pnpm dev:web   # terminal 2
pnpm diagnostics
```

Open http://127.0.0.1:5173 (dev) or the daemon port after `pnpm start`, and follow `docs/test-plans/manual-test-checklist.md`.  
Verified Fix guide: `docs/product/verified-fix-onboarding.md`  
Crash recovery: `docs/crash-recovery.md`  
Threat model: `docs/security/threat-model.md`

### Deterministic vs live providers

```bash
# Recommended for first manual pass (fake orchestration, fake hidden in UI)
ROLEFLOCK_FORCE_FAKE=1 pnpm dev

# Live routing when CLIs are installed.
# A turn is abandoned only after the provider has been silent this long
# (default 300000ms); a CLI that keeps streaming is never cut off.
# ROLEFLOCK_PROVIDER_IDLE_TIMEOUT_MS=300000 pnpm dev
```

## Current limits

- **Fake provider:** hidden from Providers UI by default; orchestration still available via `ROLEFLOCK_FORCE_FAKE=1`.
- Planner/verifier invoke Claude/Codex when discovered and not forced fake.
- Writer uses **Cursor Agent CLI** when `agent` / `cursor-agent` is on PATH (`agent -p --force --trust --sandbox enabled`). Otherwise falls back to leased `ROLEFLOCK_FIX.md` write.
- Set `ROLEFLOCK_CURSOR_AGENT=0` to force the filesystem fallback even when Agent CLI is installed.
- Install Agent CLI: `curl https://cursor.com/install -fsS | bash` then `agent login`.
- Optional **verification command** on New task (else `npm test` or artefact-present check).
- Custom OpenAI-compatible providers can be registered in Providers UI.
- Knowledge, approval grants, disclosure grants, and first-run privacy gate are available in the UI.
- Public website packaging / installer DMG is not started; use `pnpm start` locally. Draft copy lives in `docs/public/`.
- Update check is offline unless `ROLEFLOCK_UPDATE_URL` is set (payload: product + version + platform only).
- Benchmark records local fixture timings only — see `docs/benchmarks/baseline.md`.
- MVP gate summary: `docs/test-plans/mvp-readiness.md`.

## Privacy & export

- `GET /api/privacy` — live claims
- `GET /api/tasks/:id/export/evidence` / `export/audit`
- `GET /api/diagnostics/export` — redacted support bundle
- `POST /api/data/backup` / `POST /api/data/delete` (confirmed wipe)
- Draft public copy: `docs/public/privacy.md`

## After you test

Report:

1. What worked
2. Exact error text if Start/Approve failed
3. Which workflow mode you used
4. Whether you used `ROLEFLOCK_FORCE_FAKE=1` or live CLIs

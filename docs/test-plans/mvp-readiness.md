# Public MVP readiness

**Date:** 26 July 2026  
**Verdict:** Ready for local Verified Fix use. Not a packaged DMG / live roleflock.com deploy.

## Exit gate checklist

| Gate | Status |
|------|--------|
| Phase 0 / daemon acceptance suites pass | Pass (`pnpm test`) |
| Localhost auth + CSRF + origin | Pass |
| Path/symlink deny + writer lease | Pass (in-memory + durable SQLite lease) |
| Users can install via `pnpm`, connect providers, register repo, complete Verified Fix | Pass (FORCE_FAKE or live CLIs) |
| Privacy claims match data flow | Pass (first-run gate + Privacy page) |
| Cost/quota labels truthful | Pass (actual vs shadow) |
| Local export/delete | Pass |
| Crash recovery docs | Pass (`docs/crash-recovery.md`) |
| Benchmark recorded without marketing claims | Pass (`docs/benchmarks/baseline.md`) |
| Threat model | Pass (`docs/security/threat-model.md`) |
| Public site copy | Draft markdown in `docs/public/` (deploy deferred) |
| Installer DMG | Deferred (`pnpm start`) |

## Honest remaining limits

- Writer prefers Cursor Agent CLI (`agent -p --force`) when installed and authenticated; otherwise produces a leased `ROLEFLOCK_FIX.md` artefact under a permission envelope. Post-write path checks keep changes inside the worktree.
- Live Claude/Codex planner/verifier runs when discovered and not force-faked.
- Graph runtime supports bounded node retries; full M8 router/join concurrency is not required for Verified Fix MVP.
- Vendor account-wide quota dashboards are not scraped; Providers show RoleFlock local usage + CLI account identity + vendor usage buttons.

## First run

See `docs/product/verified-fix-onboarding.md`.

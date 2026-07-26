# Ready for local testing

**Date:** 26 July 2026  
**Branch:** `main` (local; not pushed unless requested)

## Automated verification

```bash
pnpm typecheck
pnpm test
pnpm build
```

Passing coverage includes:

- Daemon boundary (localhost, auth, no shell endpoint)
- Walking skeleton bug-fix flow
- Approval persistence across daemon restart
- Repository path/symlink deny + one-writer lease
- Graph mode validation
- Provider discovery honesty for missing CLIs

## How to start testing

```bash
pnpm install
pnpm build
pnpm dev      # terminal 1
pnpm dev:web  # terminal 2
```

Open http://127.0.0.1:5173 and follow `docs/test-plans/manual-test-checklist.md`.

## Known Phase 0 limits

- Orchestrator execution path uses Fake provider events (deterministic).
- Claude/Codex/Cursor are discovered and health-checked; full live CLI writing/planning loop is next.
- Custom HTTP provider adapter exists as package code; UI configuration of custom endpoints is thin.
- Public MVP packaging / installer is not started.

## After you test

Report:

1. What worked
2. Exact error text if Start/Approve failed
3. Which workflow mode you used

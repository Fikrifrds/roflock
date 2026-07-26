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
- Provider discovery + role routing (Claude/Codex/Cursor/custom)
- Cursor permission-envelope write deny

## How to start testing

```bash
pnpm install
pnpm build
pnpm dev      # terminal 1
pnpm dev:web  # terminal 2
```

Open http://127.0.0.1:5173 and follow `docs/test-plans/manual-test-checklist.md`.

### Deterministic vs live providers

```bash
# Recommended for first manual pass
ROLEFLOCK_FORCE_FAKE=1 pnpm dev

# Live routing when CLIs are installed (90s default timeout)
# ROLEFLOCK_PROVIDER_TIMEOUT_MS=90000 pnpm dev
```

## Current limits

- Planner/verifier invoke Claude/Codex when discovered and not forced fake.
- Writer uses Cursor sandboxed filesystem writes under a permission envelope + writer lease (full Cursor Agent CLI loop still deferred).
- Custom OpenAI-compatible providers can be registered in Providers UI.
- Public MVP packaging / installer is not started.

## After you test

Report:

1. What worked
2. Exact error text if Start/Approve failed
3. Which workflow mode you used

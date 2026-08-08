# Verified Fix baseline (local fixture)

**Generated:** 2026-07-26T12:53:40.374Z  
**Fixture:** local fixture (built packages/context-compiler + command-runner)

These numbers time **local RoleFlock components** (context compile + sandboxed `echo`), not a full end-to-end provider run. Label: **local fixture** — not marketing benchmarks.

## Results

| Step                                       | Iterations | Median (ms) | Total (ms) |
| ------------------------------------------ | ---------- | ----------- | ---------- |
| Context compile (planner, incl. .env deny) | 200        | 0.020       | 5.8        |
| Command runner (`echo` in sandbox)         | 20         | 1.599       | 34.2       |

## Methodology — compare vs direct agent

1. **RoleFlock path:** `ROLEFLOCK_FORCE_FAKE=1 pnpm dev`, run Verified Fix on a small repo; note wall-clock from Start → Accept.
2. **Direct agent path:** Same brief in Cursor/Claude without RoleFlock graph; note wall-clock to equivalent patch + manual test.
3. **Compare:** RoleFlock adds approval gates, evidence, and disclosure overhead; direct agent may be faster but lacks governed leases and exportable audit.

Full walking skeleton E2E timing: `pnpm test apps/daemon/test/walking-skeleton.test.ts` (automated, fake provider).

## Reproduce

```bash
pnpm build
pnpm benchmark
```

Update checks and this benchmark never transmit repository contents.

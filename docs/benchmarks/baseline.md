# Verified Fix baseline (local fixture)

**Generated:** 2026-08-08T23:03:25.633Z
**Fixture:** local fixture (built packages/context-compiler + command-runner)

These numbers time **local Roflock components** (context compile + sandboxed `echo`), not a full end-to-end provider run. Label: **local fixture** — not marketing benchmarks.

## Results

| Step                                       | Iterations | Median (ms) | p95 (ms) | Total (ms) |
| ------------------------------------------ | ---------- | ----------- | -------- | ---------- |
| Context compile (planner, incl. .env deny) | 200        | 0.019       | 0.039    | 5.3        |
| Command runner (`echo` in sandbox)         | 20         | 1.414       | 1.757    | 30.5       |

## Methodology — compare vs direct agent

1. **Roflock path:** `ROFLOCK_FORCE_FAKE=1 pnpm dev`, run Verified Fix on a small repo; note wall-clock from Start → Accept.
2. **Direct agent path:** Same brief in Cursor/Claude without a Roflock graph; note wall-clock to equivalent patch + manual test.
3. **Compare:** Roflock adds approval gates, evidence, and disclosure overhead; direct agent may be faster but lacks governed leases and exportable audit.

Full walking skeleton E2E timing: `pnpm test apps/daemon/test/walking-skeleton.test.ts` (automated, fake provider).

## Reproduce

```bash
pnpm build
pnpm benchmark
```

Update checks and this benchmark never transmit repository contents.

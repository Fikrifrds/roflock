# Crash recovery

Roflock marks unfinished durable state `interrupted`, preserves confirmed work
and spent loop budget, releases stale writer leases, and refuses to invent an
outcome for ambiguous provider work.

After an unexpected quit:

```bash
roflock daemon start
roflock status <interrupted-run-id>
roflock approvals --run <interrupted-run-id>
roflock resume <interrupted-run-id>
```

Resume reuses completed nodes only when the pinned graph and task worktree are
still compatible. Driver sessions resume only when their stored identity and
capabilities make that safe.

For reconciliation details, database backup/restore, upgrades, data deletion,
and incident handling, use the [local runtime operator guide](runtime/operator-guide.md).

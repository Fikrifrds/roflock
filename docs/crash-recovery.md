# Crash recovery

RoleFlock is local-first. Recoverability depends on the daemon process and `~/.roleflock` (or `ROLEFLOCK_DATA_DIR`).

## After an unexpected quit

1. Restart the daemon: `pnpm start` or `pnpm dev`.
2. On boot, RoleFlock reconciles orphaned process handles and marks unknown invocations.
3. Open the UI and check Approvals — pending confirmations survive restart in SQLite.
4. Re-open the task Evidence page to inspect the last disclosure and findings.

## Forced stop / Force restart

- **Stop** cancels the active node run and releases writer leases when possible.
- **Force restart** is for stuck runs after Stop fails; prefer Stop first.
- If a worktree write was mid-flight, inspect the worktree under `~/.roleflock/worktrees/` before approving another writer.

## Data recovery

```bash
# Offline checklist (no repo contents)
pnpm diagnostics

# While daemon is running (authenticated UI/API)
# POST /api/data/backup  → copies roleflock.db into ~/.roleflock/backups/<stamp>/
# GET  /api/diagnostics/export → redacted support bundle
# GET  /api/tasks/:id/export/evidence → hashed evidence bundle
# GET  /api/tasks/:id/export/audit → confirmations, events, usage
```

## Wipe local data

`POST /api/data/delete` with `{ "confirm": "DELETE_LOCAL_DATA" }` removes the SQLite database, documents store, and worktrees. Restart the daemon afterwards. Repository clones on disk are never deleted by RoleFlock.

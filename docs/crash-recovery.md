# Crash recovery

RoleFlock is local-first. Recoverability depends on the daemon process and `~/.roleflock` (or `ROLEFLOCK_DATA_DIR`).

## After an unexpected quit

1. Restart the daemon: `pnpm start` or `pnpm dev`. The launch URL is unchanged — the session
   token persists in `~/.roleflock/session.json`. Run `pnpm url` if you need it reprinted.
2. On boot, RoleFlock reconciles orphaned process handles, marks unknown invocations, and
   moves any graph run still marked `running` to `interrupted`.
3. Open the UI and check Approvals — pending confirmations survive restart in SQLite.
4. Open the task's **Run graph** panel. Nodes that finished before the crash stay `completed`;
   everything after them is `pending`.
5. Press **Start** again. The scheduler resumes from the completed set and reuses the existing
   worktree, so finished planner/reviewer/writer work is not paid for twice.

Resume only applies when the task still has an active worktree and the stored graph version
matches the current one. If either has changed, the run starts clean rather than mixing shapes.

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

# Verified Fix — first run

Use **Verified Fix** (bug-fix workflow) when you want a governed path: plan → confirm → write → test → verify → accept.

## Before you start

1. Install Node 24+ and pnpm 11+.
2. Build and run locally:

   ```bash
   pnpm install && pnpm build
   pnpm dev        # terminal 1 — daemon on 127.0.0.1:4178
   pnpm dev:web    # terminal 2 — UI on 127.0.0.1:5173
   ```

3. For a deterministic first pass (no live CLIs required):

   ```bash
   ROLEFLOCK_FORCE_FAKE=1 pnpm dev
   ```

4. Ensure at least one provider shows **ready** on the Providers page (Claude/Codex/Cursor via PATH), or rely on `ROLEFLOCK_FORCE_FAKE=1` for the walking skeleton.

## Step-by-step

### 1. Register a repository

- Open **Projects** → **Choose…** → pick a local Git repo.
- Optional: set a display name.
- RoleFlock resolves the real path and stores it under `~/.roleflock/`.

### 2. Create a Verified Fix task

- **New task** → intent **Fix a Bug** (Verified Fix).
- Write a concrete brief: expected vs actual behaviour, repro steps, files involved.
- Attach supporting documents if you have screenshots or specs (optional).

### 3. Start the flock

- Open the task → **Start**.
- Watch the graph: planner → reviewer confirmation → writer → test → verifier → accept.

### 4. Approve when asked

- If reviewer pauses for confirmation, open **Approvals** or the in-task banner → **Approve**.
- Pending approvals survive daemon restart (SQLite-backed).

### 5. Accept or reject

- When verification completes, **Accept** merges the outcome into evidence, or **Reject** to stop.
- Inspect **Evidence** for disclosure manifest, artefacts, and test output.

## What Verified Fix guarantees (Phase 0)

- One writer lease per task worktree — no concurrent writes.
- `.env`, keys, and symlink escapes are denied in repository and context paths.
- Deterministic **test** node runs sandboxed commands (not arbitrary shell).
- Secret paths and `secret` sensitivity never enter provider prompts.
- Exports and diagnostics redact keys and tokens.

## Honest limits

- **Cursor writer:** filesystem writes run under a permission envelope; full Cursor Agent CLI loop is still deferred.
- **Fake provider:** hidden from the Providers inventory by default; use `ROLEFLOCK_FORCE_FAKE=1` or `ROLEFLOCK_INCLUDE_FAKE=1` for deterministic runs.
- **Live CLIs:** planner/verifier may invoke Claude/Codex when discovered; failures surface in task state — read the error text on Start.

## If something fails

1. Note the exact error on **Start** or **Approve**.
2. Run `pnpm diagnostics` (no repo contents uploaded).
3. See [`docs/crash-recovery.md`](../crash-recovery.md) for restart and orphan recovery.
4. Export evidence/audit from the task for support: `GET /api/tasks/:id/export/evidence`.

## Next steps after a successful run

- Try the same flow without `ROLEFLOCK_FORCE_FAKE` when CLIs are installed.
- Review **Providers** for CLI login (`/api/providers/:id/auth/login`).
- Read [`docs/security/threat-model.md`](../security/threat-model.md) for the local trust boundary.

# RoleFlock privacy (Phase 0)

**Last updated:** July 2026  
**Applies to:** local daemon + web UI (`127.0.0.1`)

This document describes how RoleFlock handles data on your machine. It is written for publication at roleflock.com and should match runtime behaviour verified via `GET /api/privacy`.

## What stays local

- Registered repository paths and Git worktrees
- Task briefs, approvals, evidence, usage ledger, and SQLite database (`~/.roleflock/` or `ROLEFLOCK_DATA_DIR`)
- Uploaded task documents stored under the data directory
- Provider CLI sessions and credentials managed by vendor tools on your OS user account

RoleFlock does **not** operate a hosted multi-tenant backend in Phase 0.

## What may leave your machine

| Flow | Data sent | When |
|------|-----------|------|
| Provider CLIs (Claude, Codex, Cursor) | Prompts and context compiled for the active role | When you start a task and a live provider is selected |
| Custom HTTP provider | Request body you configure (endpoint + model) | When registered and invoked |
| Update check (optional) | Product name, version, platform | Only if `ROLEFLOCK_UPDATE_URL` is set; otherwise offline stub |
| Support export (your action) | Redacted diagnostics JSON you download | When you request export from Privacy or API |

Update checks **never** include repository paths, file contents, or API keys.

## What we do not collect centrally (Phase 0)

- No automatic telemetry upload
- No repository indexing to Mlola servers
- No account-wide billing aggregation across providers

Usage numbers in the UI are **local RoleFlock meters**, not vendor dashboards.

## Security controls

- Loopback bind by default
- Session token + CSRF on mutating API calls
- Origin allow-list for browser mutations
- No arbitrary shell HTTP endpoint
- Path/symlink deny for secrets and escapes
- Secret redaction in exports and logs
- One writer lease per task worktree

## Your controls

- **Export:** evidence, audit, and diagnostics bundles (redacted)
- **Backup:** `POST /api/data/backup` copies local database to `~/.roleflock/backups/`
- **Delete:** `POST /api/data/delete` with confirmation wipes local RoleFlock data (not your Git clones)
- **Offline diagnostics:** `pnpm diagnostics` prints a local checklist without reading repository trees

## Provider disclosure

Context sent to providers is governed by role contracts and exclusion lists. Items marked `secret` or matching paths like `.env` and `*.pem` are omitted before compilation. See disclosure manifests on each task.

## Questions

For product support, use exports from a running daemon rather than sharing raw repository trees.  
Website: https://roleflock.com

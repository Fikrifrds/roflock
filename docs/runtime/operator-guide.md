# Local runtime operator guide

This guide covers operating one Roflock daemon for one trusted OS user. Roflock
0.1 is local-first and does not require a Cloud control plane.

## Operating model

Studio, CLI, MCP, and optional local clients all use one loopback daemon and one
durable SQLite database:

```text
Studio / CLI / MCP
        ↓ authenticated loopback API
local daemon
        ↓
SQLite · worktrees · drivers · policy · approvals · evidence
```

The daemon runs as the current OS user. Registered repositories and installed
agent CLIs are therefore explicit trust boundaries. Roflock governs scheduling,
context selection, workflow transitions, writer leases, and approvals; it does
not make a privileged provider binary harmless.

## Start, inspect, and stop

```bash
roflock daemon start
roflock daemon status
roflock doctor
roflock daemon stop
```

`daemon start` either connects to an existing healthy daemon or launches the
daemon bundled with the CLI. The default address is
`http://127.0.0.1:4178`. An owned daemon can only be spawned on loopback HTTP.

Lifecycle status distinguishes:

- `owned` — the active daemon proves the nonce recorded by this CLI launch;
- `external` — healthy daemon, but no CLI ownership record;
- `unverified` — an ownership record exists but the active process does not
  prove it; and
- stopped.

`daemon stop` only signals an `owned` process. Manage an external daemon with
the service/process manager that launched it.

Owned-daemon logs are written to `<dataDir>/logs/daemon.log`. Set `LOG_LEVEL` to
`silent`, `error`, `warn`, `info`, `debug`, or `trace` before launch to change
structured daemon logging.

## Data directory

Resolution order is:

1. command `--data-dir` where supported;
2. `ROFLOCK_DATA_DIR`;
3. existing `~/.roflock`;
4. existing legacy `~/.roleflock`; or
5. new `~/.roflock`.

Roflock never moves an existing legacy directory automatically. If both current
and legacy directories exist, the current directory wins. Stop every daemon
before moving data manually.

Typical contents:

| Path                          | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `roleflock.db` (+ WAL/SHM)    | Durable tasks, snapshots, runs, approvals, events, usage, evidence |
| `session.json`                | Mode-0600 daemon token and CSRF value                              |
| `daemon-owner.json`           | Mode-0600 CLI lifecycle ownership proof                            |
| `logs/daemon.log`             | Owned-daemon logs                                                  |
| `documents/`                  | Local task document bodies                                         |
| `worktrees/`                  | Per-task Git worktrees                                             |
| `backups/<timestamp>/`        | Explicit online database snapshots                                 |
| `provider-secrets.{key,json}` | Local encrypted custom-provider credentials                        |
| `runner-signing.{key,json}`   | Separate local encrypted passport signing material                 |

The database retains its historical filename intentionally. Renaming a live
SQLite database plus its WAL/SHM sidecars without a migration would risk data
loss.

Secret stores use AES-256-GCM encrypted values and mode-0600 files, with a
separate local key file beside each store. This is an OS-user-protected fallback,
not an OS keychain or multi-user secret service. Protect the whole data
directory with normal disk encryption and account permissions.

## Session and API security

Loopback is not authorization: every local account can reach a loopback port.
Roflock uses a high-entropy token in mode-0600 `session.json`; mutations also
require CSRF, and non-local browser origins are rejected.

The browser launch URL contains the token once, then Studio stores it and
removes it from the address bar. API routes never return the token and do not
accept it from query strings. CLI and MCP read the session file directly.

Rotate a potentially exposed token by stopping the owned daemon and starting it
with rotation enabled:

```bash
roflock daemon stop
ROFLOCK_ROTATE_TOKEN=1 roflock daemon start
```

Rotation invalidates prior launch URLs. Keep `session.json`, launch URLs, and
daemon stdout private.

## Runtime configuration

The important operator settings are:

| Variable                           | Default | Effect                                                      |
| ---------------------------------- | ------- | ----------------------------------------------------------- |
| `ROFLOCK_PORT`                     | `4178`  | Loopback daemon port                                        |
| `ROFLOCK_DATA_DIR`                 | auto    | Durable data/session root                                   |
| `ROFLOCK_PROVIDER_IDLE_TIMEOUT_MS` | 300000  | Maximum provider silence, not total turn duration           |
| `ROFLOCK_VERIFICATION_TIMEOUT_MS`  | 300000  | Deterministic verification command timeout                  |
| `ROFLOCK_UPDATE_URL`               | unset   | Optional version-check endpoint                             |
| `ROFLOCK_INCLUDE_FAKE`             | unset   | Register the deterministic fake driver for explicit testing |
| `ROFLOCK_FORCE_FAKE`               | unset   | Force simulation mode; never production evidence            |

Every `readEnv` setting prefers `ROFLOCK_*` and falls back to the audited
`ROLEFLOCK_*` spelling with a deprecation warning. An explicitly empty new
variable does not fall through to a stale legacy value.

When `ROFLOCK_UPDATE_URL` is configured, the check sends only product, version,
and platform. It does not send repository paths or contents.

The TOML files generated by `roflock init` reserve the project configuration
shape, but public-alpha runtime routing still uses explicit CLI/daemon inputs.
Do not assume editing `profiles/local.toml` changes live role-to-driver routing.

## Repositories and worktrees

Each task normally gets an external Git worktree under the data directory. The
primary checkout and its current branch remain untouched. Roflock records the
base commit, branch, worktree path, status, and one-writer lease.

Before starting work:

```bash
git status --short
roflock doctor
```

An existing dirty primary checkout is user-owned state. Roflock must not reset
or overwrite it. If a task worktree is marked `dirty_preserved`, inspect it
before resuming or accepting another writer.

Deterministic checks and command actions are parsed into a binary plus argument
array and spawned without a shell. Their working directory must remain inside
the task sandbox root. Provider CLIs still run with their own host permissions;
authenticate and configure those CLIs according to the
[authentication guide](../integrations/authentication.md).

## Run supervision

```bash
roflock status <run-id>
roflock events <run-id> --after <sequence>
roflock pause <run-id>
roflock resume <run-id>
roflock cancel <run-id>
```

Use `status` for the durable projection and `events` for ordered history. Event
sequence, not wall-clock time or terminal output, is the recovery cursor.

Pause prevents new scheduling at a durable boundary. Cancel also asks active
selected drivers to interrupt, but the response uses the weakest cancellation
guarantee reported by those drivers. Only `remote-confirmed` proves remote work
stopped.

## Crash and restart recovery

On daemon startup Roflock:

1. marks graph runs, node runs, and invocations left `running` as
   `interrupted`;
2. reconciles stored process handles and records unknown outcomes rather than
   inventing success/failure;
3. releases stale writer leases; and
4. preserves completed node records, approvals, the task worktree, driver
   session identity, and spent loop budget.

After an unexpected quit:

```bash
roflock daemon start
roflock status <interrupted-run-id>
roflock approvals --run <interrupted-run-id>
roflock resume <interrupted-run-id>
```

A resume reuses completed nodes and the remaining loop budget only when the
task still resolves to the same pinned graph and has a reusable worktree. A
driver session resumes only when the same task, node, and driver have a known
session and that driver implements resume. Ambiguous billable work is not
blindly repeated.

If the worktree is missing or incompatible, Roflock creates a safe workspace
instead of mixing state and does not pretend missing work was preserved. If a
driver is unavailable, change the role binding in Studio and resume; already
confirmed graph work remains durable where safe.

## Approvals

Pending approvals are SQLite records and survive restarts. Always inspect the
exact request before deciding:

```bash
roflock approvals --run <run-id>
roflock approval <approval-id>
roflock approve <approval-id>
# or
roflock reject <approval-id>
```

An approval binds an exact action and state fingerprint. Roflock does not expose
a bulk/latest approval shortcut, and the MCP server has no approval tools.
Models cannot approve their own protected effect, acceptance, or policy
exception.

## Evidence and exports

The offline CLI can explain what the local record proves even when the daemon is
stopped:

```bash
roflock evidence <task-id>
roflock why <task-id> --file <path>
roflock passport verify <passport.json> --identity <runner.json>
```

Studio/API also provides:

- `GET /api/tasks/:id/export/evidence` — hashed evidence bundle;
- `GET /api/tasks/:id/export/audit` — task, approvals, events, and usage;
- `GET /api/diagnostics/export` — redacted support snapshot; and
- `POST /api/data/backup` — transactionally consistent SQLite snapshot.

Exports require normal daemon authentication. Diagnostics omit repository
contents, API keys, session tokens, and private-key patterns, but operators
should still inspect a support bundle before sharing it.

## Backup and restore

The **Backup local database** action in Studio uses SQLite's online backup API
while the daemon remains open. It writes:

```text
<dataDir>/backups/<ISO-timestamp>/roleflock.db
```

The resulting database passes SQLite integrity checks in the release test. It
contains durable metadata/evidence but not `documents/`, task worktree files,
logs, session/ownership files, or secret stores.

For full local disaster recovery, stop the daemon and back up the complete data
directory with an OS/file backup tool. Protect that archive as sensitive: it
contains repository worktrees, tokens, encrypted values, and their local key
files.

To restore an online database snapshot:

1. stop the daemon;
2. record the current package version and make a safety copy of the current
   data directory;
3. quarantine the current `roleflock.db`, `roleflock.db-wal`, and
   `roleflock.db-shm` together;
4. copy the selected backup `roleflock.db` into the data directory;
5. start the intended Roflock version and run `roflock doctor`; and
6. inspect representative tasks, approvals, and `roflock evidence` before
   resuming work.

Never combine a restored database with WAL/SHM files from a different snapshot.

## Upgrades and rollback

Before upgrading:

1. finish, pause, or record active run IDs;
2. create an online database backup;
3. stop the daemon;
4. retain the old package/tarball and, for full rollback, a stopped full data
   directory backup; and
5. install the exact new version.

Starting the new daemon applies ordered SQLite migrations and freezes any
eligible pre-snapshot workflow task to its historical semantics. Existing
workflow snapshots are immutable; edited templates cannot rewrite old tasks.

After upgrade, run:

```bash
roflock version
roflock daemon start
roflock doctor
roflock drivers doctor
```

Then verify interrupted/paused runs and evidence before resuming. Downgrades are
not guaranteed to understand a newer schema. Roll back both the binary and the
pre-upgrade data snapshot; do not point an older binary at a migrated database.

## Deleting operational data

Studio requires the exact confirmation `DELETE_LOCAL_DATA`. The operation
closes and removes SQLite/WAL/SHM, documents, task worktrees, provider secret
stores, and runner-signing secret stores, then recreates empty document/worktree
directories. Restart the daemon afterward.

It does not delete registered primary Git repositories, explicit database
backups, daemon logs, or the session/ownership control files. This is an
operational reset, not forensic secure erasure. Review and remove retained
backups/logs separately if policy requires it, and run `git worktree prune` in
registered repositories if Git reports stale worktree registrations.

## Incident checklist

If a token, provider credential, or signing key may be exposed:

1. pause/cancel affected runs and record the weakest cancellation guarantee;
2. rotate the Roflock session token;
3. revoke or rotate credentials through the owning provider CLI/service;
4. stop the daemon and protect a forensic copy if investigation is required;
5. inspect audit/evidence exports for affected task IDs; and
6. report a Roflock vulnerability through the process in `SECURITY.md` rather
   than a public issue.

See the [threat model](../security/threat-model.md), [CLI reference](../cli/reference.md),
and [control-surface API](../integrations/control-surface-api.md).

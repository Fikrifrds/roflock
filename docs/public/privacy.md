# Roflock local privacy summary

**Last updated:** 9 August 2026

**Applies to:** public-alpha CLI, loopback daemon/Studio, and static Playground

Roflock has no hosted account or multi-tenant backend in public alpha. Runtime
state is stored under the active local data directory. Local-first does not mean
that live agent work is offline: selected prompts and repository context are
sent to the harness/provider the operator configured.

## Stored locally

- registered repository paths, task briefs, immutable workflow snapshots,
  Graph IR, events, approvals, evidence, usage, and audit records;
- the SQLite database, task documents, and managed worktrees;
- daemon session/CSRF material and Roflock-owned provider/runner-signing secret
  stores; and
- explicit backups and redacted diagnostics exports.

New installs use `~/.roflock`; an existing `~/.roleflock` install remains there
for compatibility. `ROFLOCK_DATA_DIR` selects another location. Provider CLI
OAuth/subscription credentials remain in each harness's own storage and are not
copied into the Roflock database.

## Data that may leave the machine

| Flow                              | Data                                                                                    | Trigger                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Coding harness/provider           | Role objective and selected compiled context; provider-defined telemetry may also apply | Operator starts a live run with that route               |
| Custom OpenAI-compatible endpoint | Model request body and selected context                                                 | Operator registers and routes to the endpoint            |
| Optional update endpoint          | Product, version, and platform only                                                     | `ROFLOCK_UPDATE_URL` is configured and update check runs |
| Support/GitHub                    | Only what the operator chooses to upload                                                | Operator files a report or attaches an inspected export  |

Roflock's update check does not include repository paths/content or API keys.
The project ships no automatic Roflock telemetry upload in public alpha.

## Playground

The public Playground is a separate static site. Source is held in browser
memory or a share-link URL fragment and is not stored by a Roflock server. It
makes no daemon or compilation-time network request. Browser extensions,
history sync, screenshots, and copied links may still expose fragments, so
workflow source must not contain secrets.

## Operator controls

- Evidence, audit, Change Passport, and diagnostics exports are explicit.
- Diagnostics are redacted and omit repository content, but should still be
  inspected before sharing.
- SQLite backups use the online backup API for a consistent live snapshot.
- Data deletion removes SQLite/WAL/SHM, documents, managed worktrees,
  provider-secret stores, and runner-signing stores.
- Data deletion keeps Git repositories, backups, logs, and daemon session
  authentication; these require separate deliberate operator action.

The complete procedures and file inventory are in the
[operator guide](../runtime/operator-guide.md). Runtime claims are also exposed
by authenticated `GET /api/privacy`.

## Security

The daemon binds to loopback by default and requires a mode-`0600` session
secret, local-origin policy, and CSRF protection. Loopback alone is not
authentication. There is no generic shell HTTP endpoint. Permission, lease,
approval, and verification controls are enforced outside model prompts.

Report vulnerabilities privately according to [SECURITY.md](../../SECURITY.md).

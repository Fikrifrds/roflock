# Roflock CLI reference

The `roflock` executable is the public local interface to the language
compiler, governed runtime, daemon lifecycle, approvals, drivers, and evidence.
It does not require a Roflock Cloud account.

## Requirements and installation

Roflock 0.1 requires Node.js 24 or newer and Git. A supported agent CLI must be
installed and authenticated separately before a live agent run; compilation,
rendering, initialization, evidence reads, and passport verification do not
contact an agent provider.

After the package is published:

```bash
npm install --global roflock
roflock --version
roflock --help
```

Until publication, install the exact artifact built from a checkout:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --dir apps/cli build

cd apps/cli
npm pack
npm install --global ./roflock-0.1.0.tgz
```

The package installs four binaries:

- `roflock` — supported CLI;
- `roflock-lsp` — local Language Server Protocol executable;
- `roflock-mcp` — stdio MCP server; and
- `roleflock` — deprecated compatibility alias.

The package is Apache-2.0 and self-contained: consumers do not need the
monorepo or private `@roleflock/*` packages.

## Discovering the contract

```bash
roflock help
roflock help --json
roflock version
```

`help --json` returns the versioned automation contract, including commands
that support `--json`, native machine-output commands, and stable exit codes.
Scripts should discover capabilities from that document instead of scraping
human help.

## Language commands

Language commands are local, read-only compiler operations. They never start a
run, spawn a provider, or modify the target repository.

### `check`

```bash
roflock check <workflow.roflock>
```

Compiles and validates the workflow. Success prints a graph summary and its
semantic hash. Diagnostics go to stderr with stable `RF…` codes and source
locations.

### `compile`

```bash
roflock compile <workflow.roflock>
roflock compile <workflow.roflock> --out <workflow.ir.json>
```

Emits normalized canonical Graph IR JSON to stdout or the selected file. No
informational text precedes stdout JSON.

### `validate-ir`

```bash
roflock validate-ir <workflow.ir.json>
```

Validates a Graph IR 1.0 document. If the document carries a semantic hash, the
command recomputes it and rejects content that no longer matches the stamp.

### `hash`

```bash
roflock hash <workflow.roflock>
roflock hash <workflow.ir.json>
```

Prints one semantic-hash line. Formatting and comments do not change a source
workflow's semantic hash.

### `render`

```bash
roflock render <workflow.roflock>
roflock render <workflow.roflock> --out <workflow.mmd>
```

Emits Mermaid text using the same shared graph contract as Studio and the
Playground.

See the [language reference](../language/reference.md) for syntax and
diagnostics.

## Starting a local run

Start or connect to the daemon first, then run exact source against a Git
repository:

```bash
roflock daemon start
roflock doctor
roflock studio

roflock run workflow.roflock \
  --repo /absolute/path/to/repository \
  --brief "Repair the failing parser test" \
  --title "Parser repair"
```

Syntax:

```text
roflock run <workflow.roflock>
  --repo <path>
  --brief <text>
  [--title <text>]
  [--daemon-url <url>]
  [--data-dir <path>]
  [--json]
```

The command reads the source, registers or resolves the repository as a local
project, compiles and bridges the workflow through the daemon, creates an
immutable task snapshot, and starts the single governed runtime. Success
returns both IDs:

- `taskId` identifies the durable task, evidence chain, and immutable workflow
  snapshot; and
- `graphRunId` identifies one runtime attempt/projection and is the `<run-id>`
  accepted by status, events, and control commands.

Public-alpha CLI starts are explicitly marked uncontracted when no Change
Contract was supplied. The warning is disclosure, not permission to bypass
checks, writer serialization, policy, or human approval.

## Inspecting runs

### `status`

```bash
roflock status <run-id>
roflock status <run-id> --json
```

Shows the durable graph state, operator-facing `taskState`, task/workflow
identity, node counts, and block reason. A human node can show graph `running`
while the task is `awaiting_acceptance`; that status correctly exits 5 rather
than looking like ordinary in-flight work. A successful HTTP request is not
automatically exit 0.

### `events`

```bash
roflock events <run-id>
roflock events <run-id> --after 42 --json
```

Returns ordered durable events whose sequence is greater than `--after`.
Persist the last processed sequence and resume from it; reconnecting does not
require replaying or guessing transient output.

`--after` must be a non-negative integer and is only valid for `events`.

## Controlling runs

```bash
roflock pause <run-id> [--json]
roflock resume <run-id> [--json]
roflock cancel <run-id> [--json]
```

Pause stops new scheduling at a durable boundary. Resume continues a safe
paused/interrupted run and may return the active run ID. Cancel stops scheduling
and asks each active selected driver to interrupt.

Cancellation wording is capability-aware. Only a `remote-confirmed` driver can
prove remote work stopped; process termination or local acknowledgement is not
reported as stronger evidence than the driver supplies.

## Human approvals

```bash
roflock approvals [--run <run-id>] [--task <task-id>] [--json]
roflock approval <approval-id> [--json]
roflock approve <approval-id> [--json]
roflock reject <approval-id> [--json]
```

`approvals` lists pending requests and may filter by run, task, or both.
`approval` shows the exact requested action, rationale, risk, affected paths,
command preview, destination, and state fingerprint when present.

Approve or reject exactly one pending ID. There is no “latest” shortcut and no
bulk wildcard. MCP intentionally exposes no approval tool, so the process or
agent that started work does not automatically gain acceptance authority.

### Final task acceptance

An authored workflow may end at a human acceptance node. This is distinct from
an intermediate approval request and uses the task ID returned by `roflock run`:

```bash
roflock accept-task <task-id>
roflock reject-task <task-id>
```

Both commands fail closed unless the task is exactly `awaiting_acceptance`.
They support `--json`, `--daemon-url`, and `--data-dir`. Acceptance is awaited
until the Change Passport has been issued, so a successful command means the
decision and its resulting evidence are durable.

Listing one or more pending approvals and inspecting a pending approval return
exit 5 (`Blocked`) even though the command successfully returned data.

## Daemon lifecycle

```bash
roflock studio [--json]
```

Starts or connects to the daemon and prints the private authenticated Studio
URL. The URL contains the one-time session handoff token; do not paste it into
logs, issues, or shared terminals. `--json` is intended for a trusted local
launcher and returns `url`, `baseUrl`, `dataDir`, and daemon ownership.

```bash
roflock daemon start [--json]
roflock daemon status [--json]
roflock daemon stop [--json]
```

`start` connects to a healthy daemon already on the configured loopback URL or
starts the daemon bundled in the npm package. A started process writes an
ownership proof, log, and session material under the data directory.

`status` distinguishes `owned`, `external`, `unverified`, and stopped. `stop`
signals only a process that proves it is the CLI-owned daemon. It refuses a PID
record that does not match the authenticated daemon.

The default URL is `http://127.0.0.1:4178`. An owned daemon must use loopback
HTTP; Roflock will not spawn one on an arbitrary remote URL.

## Environment and setup

### `init`

```bash
roflock init
roflock init --dir <project-directory> --json
```

Creates this credential-free scaffold without overwriting user content:

```text
.roflock/
├── roflock.toml
├── workflows/bugfix.roflock
├── profiles/local.toml
└── policies/default.toml
```

Running it again is byte-idempotent. Before writing anything, it checks all four
destinations; any differing file blocks the entire operation. In 0.1, the
profile and policy TOML files reserve the project configuration contract, while
`roflock run` still receives workflow, repository, and runtime driver routing
through explicit CLI/daemon inputs. Do not put provider credentials in the
scaffold.

### `doctor`

```bash
roflock doctor [--json]
```

Checks the installed Roflock version, Node 24+, Git, current Git repository,
worktree support, daemon, and freshly reported driver readiness. Readiness
requires a usable repository, running daemon, and at least one authenticated,
runnable driver.

### `drivers`

```bash
roflock drivers [--json]
roflock drivers doctor [--json]
```

Reports `installed`, `detected`, `authenticated`, and `runnable` separately,
plus capabilities such as workspace write, resume, cancellation, and permission
controls. `doctor` requests a fresh provider probe rather than cached inventory.
The command exits 7 when no registered driver is runnable.

Authentication remains owned by each harness CLI. See
[authentication](../integrations/authentication.md).

## Evidence and passports

### `evidence`

```bash
roflock evidence <task-id> [--data-dir <path>] [--json]
```

Reads the SQLite evidence record directly; the daemon and providers do not need
to be running. The report names recorded contract, plan, artifacts,
verification, review, approval, disclosure, and any gaps. Gaps are an honest
answer and do not make the command fail.

### `why`

```bash
roflock why <task-id> --file <path> [--data-dir <path>] [--json]
```

Shows which recorded outputs mention one file. “No recorded output” does not
claim the file has no external history.

### `passport verify`

```bash
roflock passport verify <passport.json> \
  --identity <runner.json> \
  [--subject <subject.json>] \
  [--revocation <revocation.json> | --revocation-current] \
  [--now <ISO-timestamp>] \
  [--json]
```

Performs offline signature, identity, optional subject, expiry, and revocation
verification. No daemon or network is required. A parsed passport that fails
integrity returns exit 4; malformed inputs/usage return exit 2. Unknown
revocation is reported separately and never described as current.

## JSON and stream contract

Commands listed in `roflock help --json` accept `--json` and follow this
contract:

- success writes exactly one JSON document to stdout;
- diagnostics or progress never precede that document;
- failure writes exactly one JSON object to stderr with `error` and `exitCode`;
- stdout remains empty on failure.

The language machine-output commands do not need `--json`: `compile` emits IR
JSON, `hash` emits one hash, and `render` emits Mermaid. `check` and
`validate-ir` use line diagnostics and process exit status.

Automation should parse fields, not human prose. New optional fields may be
added within the 1.0 JSON schema; changing an existing field's meaning requires
a new schema version.

## Exit codes

| Code | Name       | Meaning                                                        |
| ---- | ---------- | -------------------------------------------------------------- |
| 0    | success    | Command succeeded or run is active/completed/accepted          |
| 1    | internal   | Unexpected Roflock bug or unknown future run state             |
| 2    | usage      | Bad CLI usage, source/IR validation, malformed/not-found input |
| 3    | config     | Missing daemon/session/database or unusable local setup        |
| 4    | run failed | Workflow/check/rejection/integrity result failed               |
| 5    | blocked    | Human decision/conflict is required                            |
| 6    | cancelled  | Run is cancelled, stopping, or interrupted without a reason    |
| 7    | driver     | Provider/driver failure or no runnable driver                  |

Read the exact HTTP and run-state mapping in [exit codes](exit-codes.md).

## Common connection options

Daemon-backed commands accept:

- `--daemon-url <url>` — override the local API URL for that invocation;
- `--data-dir <path>` — select the matching session/data directory; and
- `--json` — use the automation stream contract where supported.

Equivalent environment variables:

| Variable               | Purpose                                       |
| ---------------------- | --------------------------------------------- |
| `ROFLOCK_DATA_DIR`     | Data/session directory                        |
| `ROFLOCK_PORT`         | Default loopback daemon port                  |
| `ROFLOCK_DAEMON_URL`   | Full daemon URL used by the CLI               |
| `ROFLOCK_DAEMON_ENTRY` | Advanced override for bundled daemon entry    |
| `ROFLOCK_ROTATE_TOKEN` | Mint a new daemon session token on next start |

`ROLEFLOCK_DATA_DIR`, `ROLEFLOCK_PORT`, and other audited legacy env names
remain compatibility fallbacks where the migration audit records them. New
automation should use `ROFLOCK_*`.

## Troubleshooting

### No local daemon session

Run:

```bash
roflock studio
roflock daemon status
```

The CLI reads `session.json` from the same data directory as the daemon. If you
override `--data-dir` or `ROFLOCK_DATA_DIR`, use the same value for every
daemon-backed command.

### Port already in use

Use a consistent URL/port for daemon and CLI:

```bash
ROFLOCK_PORT=4210 roflock daemon start
ROFLOCK_PORT=4210 roflock doctor
```

Or set `ROFLOCK_DAEMON_URL=http://127.0.0.1:4210`.

### Daemon will not stop

`daemon stop` intentionally refuses external or unverified processes. Stop an
externally managed daemon with the service/process manager that started it. Do
not delete the ownership record and signal a guessed PID.

### No runnable driver

```bash
roflock drivers doctor
```

Install and log in through the selected agent CLI, then probe again. Installed
does not imply authenticated, and authenticated does not imply the driver's
required runtime capabilities are available.

### Workflow validates but cannot start

`check` proves source-to-IR validity. Starting a run additionally checks the
current runtime bridge, repository, driver capabilities, policies, and exact
execution semantics. Read the daemon error code; unsupported semantics fail
closed rather than being dropped.

### Existing RoleFlock data

Roflock prefers `~/.roflock`. If it does not exist but `~/.roleflock` does, the
daemon continues using the legacy directory and warns once. The database file
remains `roleflock.db` for compatibility. Stop the daemon before manually
moving a data directory.

## MCP

`roflock-mcp` is a stdio adapter over the same compiler and daemon. It exposes
exactly `roflock_check`, `roflock_compile`, `roflock_run`, `roflock_status`, and
`roflock_events`; it has no approval or rejection tool. See the
[MCP RFC](../rfc/RFC-002-ROFLOCK-MCP-V1.md) and
[harness examples](../integrations/harness-invocation.md).

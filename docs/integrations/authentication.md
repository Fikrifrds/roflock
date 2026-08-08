# Harness authentication and credential ownership

Roflock reuses authentication owned by installed coding harnesses. It does not
ask users to paste Codex, Claude Code, Cursor, OpenCode, or Pi credentials into
a `.roflock` workflow, project scaffold, or workflow snapshot.

```text
user logs in with harness
        ↓ harness-owned credential store
Roflock probes non-secret account status
        ↓
AgentDriver starts the same harness process
```

This is local authentication reuse, not credential import. Roflock does not
broker a shared account, refresh vendor OAuth tokens, or make a local login
portable to another machine.

## Shipped harnesses

| Harness     | Readiness probe              | Login owner      | What Roflock reads                                        |
| ----------- | ---------------------------- | ---------------- | --------------------------------------------------------- |
| Codex       | `codex login status`         | Codex CLI        | status text and non-secret `auth_mode` label              |
| Claude Code | `claude auth status`         | Claude Code CLI  | reported login/account metadata                           |
| Cursor      | `agent status --format json` | Cursor Agent CLI | reported auth state; app presence is only a weak fallback |
| OpenCode    | `opencode auth list`         | OpenCode CLI     | count/existence of configured provider credentials        |

`roflock drivers doctor --json` keeps four facts separate:

- `installed`: a candidate executable was found;
- `detected`: a production driver is registered for it;
- `authenticated`: the harness-specific probe verified usable auth; and
- `runnable`: all required facts for a run are currently true.

Executable presence alone is never reported as authenticated. Probe failures
fail closed and include a remediation hint without exposing tokens.

Use each harness's own login command:

```bash
codex login
claude auth login
agent login
opencode auth login
```

Studio may launch these commands as a convenience, but the resulting state
still belongs to the harness. Logout/switch delegates to the corresponding CLI.

## Pi status

Pi is a documented compatibility spike, not a registered production driver.
Its provider authentication must remain owned by Pi when `driver-pi` is built.
Roflock must probe it without copying `~/.pi/agent/auth.json`; see
[Pi compatibility](./pi-compatibility.md).

## Direct/custom providers

A user-created OpenAI-compatible endpoint is the exception: its API key is
BYOK material entered explicitly for that connection and stored through the
local secret-store boundary. It is not written into `.roflock` source, Graph
IR, event payloads, diagnostics exports, or generated project configuration.

Environment variables remain owned by the process that launches the daemon.
Roflock does not migrate them into persistent storage. Teams should inject them
through their normal local secret manager or service supervisor.

## Explicit non-support

Public alpha does not provide:

- Roflock Cloud accounts or a hosted credential vault;
- credential synchronization between machines;
- copying one harness's OAuth/session files into another harness;
- browser Playground access to local harness credentials;
- credentials embedded in execution profiles or `.roflock` source;
- automatic authentication inferred from a binary being installed;
- token export through CLI JSON, MCP, the control API, logs, or evidence; or
- a guarantee that vendor subscription auth is permitted for every automation
  scenario—users remain responsible for each provider's terms.

## Operational checks

Before a real run:

```bash
roflock doctor --json
roflock drivers doctor --json
```

If `installed` is true but `authenticated` is false, authenticate with the
harness directly and rerun the fresh probe. If authentication is true but
`runnable` is false, inspect the reported driver registration, model, and
capability details; do not copy credential files into the repository as a fix.

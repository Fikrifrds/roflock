# Invoke Roflock from an existing coding harness

Roflock can be the governed outer workflow while Codex, Claude Code, OpenCode,
or another coding agent remains the interface you work in. The recommended
boundary is the local `roflock-mcp` stdio server. A shell-capable harness can
also call the CLI directly.

## Prerequisites

After the public package has been published:

```bash
npm install -g roflock
roflock --version
roflock daemon start
roflock doctor
```

For a source checkout, build the package and use the generated executable by
absolute path instead:

```bash
pnpm --filter roflock build
node "$PWD/apps/cli/dist/bin/roflock.js" daemon start
```

The MCP server does not start the daemon implicitly. `roflock_check` and
`roflock_compile` work without it; run/status/events require the owned or
external authenticated local daemon.

## Codex

OpenAI's current Codex MCP configuration supports local stdio commands. Add the
installed Roflock server, then verify it:

```bash
codex mcp add roflock -- roflock-mcp
codex mcp get roflock
codex mcp list
```

Codex CLI, the IDE extension, and the ChatGPT desktop app share the relevant
MCP configuration. See the official
[Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Example request inside Codex:

```text
Use roflock_check on this complete workflow source. If it is executable, use
roflock_run with repository /absolute/path/to/repo and brief "Fix the parser
regression". Return the graphRunId, then follow it with roflock_events. Do not
claim or attempt approval; I will decide protected gates in Roflock Studio.
```

## Claude Code

Add the same local server at user or project scope:

```bash
claude mcp add --scope user roflock -- roflock-mcp
claude mcp get roflock
claude mcp list
```

Use `--scope project` only when the team intends to share that local-command
configuration and reviewers accept it. Claude Code treats project MCP config as
an explicit trust decision.

Example request inside Claude Code:

```text
Read .roflock/workflows/bugfix.roflock, pass the complete text to
roflock_compile, and summarize diagnostics. If I explicitly ask you to start
it, call roflock_run against this repository and report its IDs. Never approve
or reject a Roflock gate for me.
```

## OpenCode

OpenCode configuration differs across its active release lines. For releases
using the local MCP object documented below, add this to the applicable
`opencode.json`/`opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "roflock": {
      "type": "local",
      "command": ["roflock-mcp"],
      "enabled": true
    }
  }
}
```

Then verify the installed release's resolved configuration:

```bash
opencode mcp list
```

Newer OpenCode v2 configuration nests entries under `mcp.servers` and uses
`disabled: false`; follow its [versioned MCP
documentation](https://opencode.ai/v2/docs/mcp-servers) rather than mixing the
two schemas.

## Pi and any shell-capable harness

There is no shipped Pi MCP package or Pi driver. Pi can still invoke the
installed CLI through its shell tool, as can any local agent with an explicit
command allowlist:

```bash
roflock check .roflock/workflows/bugfix.roflock
roflock compile .roflock/workflows/bugfix.roflock -o /tmp/bugfix.ir.json
roflock run .roflock/workflows/bugfix.roflock \
  --repo "$PWD" \
  --brief "Fix the parser regression" \
  --json
```

Pass the returned `graphRunId` to durable reads:

```bash
roflock status <graphRunId> --json
roflock events <graphRunId> --after 0 --json
```

Do not let a harness generate `approve` or `reject` commands automatically.
Those CLI commands intentionally require one exact pending approval ID and are
reserved for the human operator.

## MCP v1 tool boundary

The installed server exposes exactly:

```text
roflock_check
roflock_compile
roflock_run
roflock_status
roflock_events
```

It exposes no approval, rejection, policy mutation, secret, shell, or arbitrary
file-read tool. Check and compile accept source text. Run accepts complete
source, an explicit absolute repository path, a brief, and an optional title.
All runtime calls reuse the immutable workflow snapshot and existing daemon;
MCP is not a second runtime.

## Remove the integration

```bash
codex mcp remove roflock
claude mcp remove --scope user roflock
```

For OpenCode, remove the matching configuration entry and rerun
`opencode mcp list`. Removing an MCP registration does not delete Roflock run
history or harness credentials.

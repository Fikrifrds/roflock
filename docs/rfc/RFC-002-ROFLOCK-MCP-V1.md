# RFC-002 — Roflock MCP v1

**Status:** Accepted  
**Version:** 1.0  
**Date:** 9 August 2026  
**Scope:** Local MCP adapter for the public Roflock compiler and governed runtime

---

## 1. Decision

Roflock ships a local stdio MCP server named `roflock-mcp`. It is an adapter
over the same compiler, authenticated daemon API, immutable workflow snapshot,
and durable runtime used by the CLI and Studio.

```text
MCP host
   ↓ stdio, inherited local user authority
roflock-mcp
   ├─ check / compile → Language → Graph IR validator
   └─ run / status / events → authenticated loopback daemon → runGraph
```

MCP introduces no graph semantics, runtime, database, approval engine, or
credential store.

## 2. Goals

- Let Codex, Claude Code, OpenCode, Pi, and compatible MCP hosts compile and
  invoke one `.roflock` workflow without leaving their preferred interface.
- Preserve exact source and semantic identity when starting a run.
- Return machine-readable diagnostics, run IDs, projections, and event cursors.
- Keep protected human decisions outside the invoking agent.
- Work without a Roflock Cloud account.

## 3. Non-goals

MCP v1 does not provide:

- an alternate runtime;
- a browser-to-local bridge;
- remote HTTP transport;
- implicit daemon startup;
- approval, rejection, grant, policy mutation, or secret-management tools;
- direct shell or arbitrary file-read tools;
- a way for an agent to widen its role, path, command, network, retry, or cost
  authority.

## 4. Transport and trust boundary

The only v1 transport is stdio using the official MCP TypeScript SDK. The MCP
host starts the process as the current OS user. Runtime tools authenticate to
the loopback daemon using that user's mode-`0600` session file.

Installing an MCP server into a host is a security decision: that host may ask
Roflock to start a governed run against an explicit repository. The host does
not receive the daemon token, provider credentials, or secret-store contents
from a tool response.

Public websites cannot start `roflock-mcp`, inherit its stdio stream, or reach
the local daemon through this design. Any future network transport requires a
new RFC with origin, authentication, CSRF, replay, user-presence, and approval
analysis.

## 5. Tool contract

MCP v1 exposes exactly:

| Tool              | Effect       | Contract                                                                  |
| ----------------- | ------------ | ------------------------------------------------------------------------- |
| `roflock_check`   | read-only    | Compile source and return diagnostics plus semantic counts.               |
| `roflock_compile` | read-only    | Return canonical Graph IR and diagnostics; never execute.                 |
| `roflock_run`     | state change | Compile exact source, register an explicit repository, and start one run. |
| `roflock_status`  | read-only    | Read one durable run projection by stable run ID.                         |
| `roflock_events`  | read-only    | Read ordered durable events after a non-negative sequence cursor.         |

Tool names and structured fields are compatibility contracts for the public
alpha. New tools may be added compatibly. Renaming or changing existing field
meaning requires a versioned migration.

## 6. Approval isolation

There is deliberately no `approve`, `reject`, `grant`, or equivalent MCP tool.

```text
agent → roflock_run          allowed by local MCP installation
runtime → protected gate    blocks durably
agent → approve itself      impossible through MCP v1
human → CLI or Studio       explicit decision
```

The run tool does not convert an MCP request into approval authority. Existing
policy, role, artifact, deterministic-check, and human gates remain enforced by
the runtime after launch.

## 7. Source and repository handling

`roflock_check` and `roflock_compile` accept source text, not a filesystem path.
They therefore cannot be abused as arbitrary file-read tools.

`roflock_run` accepts complete source text, an explicit repository path, a
non-empty brief, and an optional title. The daemon resolves and validates the
repository using its existing project boundary. Task creation stores source,
canonical Graph IR, executable graph, semantic hash, integrity hash, and
immutable workflow identity before execution.

## 8. Error and output rules

Every tool returns JSON text and structured content describing the same value.
Operational failures return an MCP tool error; they are not converted into a
successful empty result. Diagnostics remain typed compiler diagnostics.

MCP server logs and incidental messages must never be written to stdout because
stdout is the protocol stream. Startup failures may use stderr.

## 9. Version negotiation

The server uses the official v2 SDK's `serveStdio` entry, which owns protocol-era
negotiation and pins one server instance to the connection. Package smoke tests
perform a real legacy initialize handshake and verify `tools/list`; future
protocol eras remain the SDK transport's responsibility, not Roflock business
logic.

## 10. Verification requirements

Release gates must prove:

1. tool registration includes exactly the five v1 tools;
2. no approval-like tool is exposed;
3. check and compile use the public language pipeline;
4. run sends exact source to the authenticated runtime API;
5. stdio emits protocol JSON only;
6. packed, clean-installed `roflock-mcp` completes initialize and tools/list;
7. private workspace dependencies do not leak into the npm install closure.

## 11. Future work

Candidate additions require normal ticket/RFC review: evidence reads, resources,
prompts, explicit daemon lifecycle discovery, and a versioned remote transport.
Approval delegation remains out of scope unless a future design can prove
independent human identity and user presence; convenience alone is insufficient.

# Pi coding-agent compatibility spike

**Decision date:** 9 August 2026

**Status:** compatible integration surface identified; no shipped `driver-pi`

Pi is a suitable future Roflock harness because it offers two supported
programmatic surfaces:

- a Node.js SDK built around `createAgentSession()`; and
- process-isolated RPC mode, started with `pi --mode rpc`, using strict
  LF-delimited JSON records over stdin/stdout.

The upstream references used for this spike are Pi's
[coding-agent README](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md),
[RPC protocol](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md),
and [SDK guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md).
Upstream package and repository ownership has changed before, so an
implementation must pin and verify the chosen package/version rather than
depending on an unversioned namespace.

## Recommended v0 integration

Use RPC as the first production boundary:

```text
Roflock AgentDriver
        ↓ child-process lifecycle
pi --mode rpc
        ↓ strict JSONL
Pi agent session and provider authentication
```

RPC preserves process isolation, lets Pi retain its own agent loop and tools,
and avoids loading third-party Pi extensions into the daemon process. The SDK
remains a later optimization after the RPC driver has passed conformance.

The implementation must use an LF-only byte framer. Pi explicitly warns that a
generic line reader can split valid JSON strings on Unicode line separators.
Malformed JSON, an unexpected response ID, protocol output on stderr, or EOF
before `agent_end` must fail the turn as a driver/protocol error.

## AgentDriver mapping

| Roflock contract | Pi RPC mapping                                                        |
| ---------------- | --------------------------------------------------------------------- |
| `detect`         | Resolve the configured `pi` binary and probe its version/help output. |
| `authenticate`   | Probe configured provider/model without exposing `auth.json`.         |
| `start`          | Spawn RPC in the task worktree and send one correlated prompt.        |
| output/reasoning | Translate supported message-update events conservatively.             |
| tool events      | Translate explicit Pi tool lifecycle events only.                     |
| session identity | Persist a Pi session identifier only when Pi reports one.             |
| `resume`         | Resume the exact persisted session; never silently start fresh.       |
| `interrupt`      | Abort/terminate the local RPC process and report the weakest proof.   |
| model selection  | Forward an explicitly configured provider/model if Pi accepts it.     |

## Capability ceiling before implementation

No Pi capability is registered by this repository today. A future driver must
start from these conservative claims and raise them only with tests:

| Capability          | Maximum initial claim | Reason                                                         |
| ------------------- | --------------------- | -------------------------------------------------------------- |
| streaming           | `true`                | RPC emits streamed events.                                     |
| structured output   | `false`               | JSONL framing does not prove model output schema enforcement.  |
| workspace read      | `true`                | Pi supplies read-oriented coding tools.                        |
| workspace write     | conditional           | Only with an enforced write tool/path envelope.                |
| sessions/resume     | conditional           | Requires exact persisted-session round trip.                   |
| cancellation        | `local-process`       | Killing RPC does not prove an in-flight provider call stopped. |
| usage reporting     | conditional           | Only fields emitted and reconciled by the selected provider.   |
| permission controls | conditional           | Must prove tools cannot escape allowed paths/commands.         |

Pi's SDK exposes read-only and coding tool sets, but tool selection alone does
not prove Roflock's exact path and command ceilings. A driver may not report
`permissionControls: true` until adversarial conformance shows that writes,
shell commands, extensions, and discovered project configuration cannot widen
the envelope.

## Authentication ownership

Pi owns its provider authentication. Roflock should detect readiness without
copying or printing Pi's auth data. Environment API keys remain owned by the
launch environment; subscription/OAuth state remains in Pi's storage. Roflock
must not import Pi credentials into its own database or scaffold.

## Exit criteria for `driver-pi`

A Pi driver is shippable only after all of the following pass:

1. a version-pinned RPC fixture and one opt-in live probe;
2. the public `runDriverConformance` suite;
3. read-only and write-envelope escape tests;
4. strict JSONL fragmentation, malformed-record, correlation, and EOF tests;
5. exact session/resume behavior if claimed;
6. interruption reporting capped at `local-process` unless remote stop is
   independently confirmed;
7. authentication detection that separates installed, authenticated, and
   runnable states; and
8. package smoke on every OS where the driver is advertised.

Until those gates exist, `roflock drivers` intentionally does not list Pi. The
absence is truthful product behavior, not automatic detection debt.

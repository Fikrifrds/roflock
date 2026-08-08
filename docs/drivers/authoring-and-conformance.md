# AgentDriver authoring and conformance

An `AgentDriver` connects Roflock's governed runtime to an existing coding
harness. The harness keeps its own agent loop, tools, process model, and
authentication. A driver detects it, declares only capabilities it can prove,
starts or resumes one turn, translates its events, and reports the weakest true
stop guarantee.

Drivers are runtime integrations, not workflow semantics:

```text
.roflock → Graph IR → runtime → AgentDriver → coding harness
```

Graph IR must never contain Codex-, Claude-, OpenCode-, Pi-, or model-specific
behavior. Adding a driver must not create another scheduler or execution path.

## Public-alpha extension boundary

The contract is implemented in `packages/provider-core`; the reference driver
and conformance runner are in `packages/test-support`. These workspace packages
are currently private implementation modules bundled into the `roflock` npm
artifact. Public alpha does **not** load arbitrary third-party driver packages
at runtime.

This guide therefore covers source contributions and downstream source builds.
An external dynamic-driver ABI would need its own versioned RFC, package
distribution, trust model, and registration mechanism. For a provider that
already implements the OpenAI-compatible chat-completions API, use Studio's
custom-provider path instead of forking a driver merely to change an endpoint.

## Contract

The source-level interface is:

```ts
interface AgentDriver {
  readonly id: string;

  detect(): Promise<DriverAvailability>;
  capabilities(): Promise<DriverCapabilities>;
  models?(): Promise<ProviderModel[]>;

  start(request: AgentRunRequest): AsyncIterable<AgentEvent>;
  resume?(sessionId: string, request: AgentRunRequest): AsyncIterable<AgentEvent>;
  interrupt?(invocationKey: string): Promise<InterruptResult>;
  dispose?(sessionId: string): Promise<void>;
}
```

`detect()` keeps `detected` and `authenticated` separate. Finding a binary does
not prove that a user is signed in. Detection must fail closed, avoid reading or
printing secret values, and return useful non-secret detail.

`capabilities()` reports all of these explicitly:

- streaming and structured output;
- workspace read and write;
- session identity and true resume;
- cancellation guarantee;
- usage reporting, model selection, and effort selection;
- tool lifecycle events; and
- enforceable permission controls.

An unknown capability is `false`, not “probably supported.” Capability values
are promises consumed by routing, recovery, accounting, and the UI.

### Run request

`AgentRunRequest` supplies a stable `invocationKey`, objective, exact worktree,
optional model/effort/session, abort signal, and a permission ceiling:

```ts
permissions: {
  workspaceWrite: boolean;
  network: boolean;
  allowedPaths?: readonly string[];
  allowCommands?: boolean;
  allowedCommands?: readonly string[];
}
```

The driver may narrow this envelope but must never widen it. Prompt text is not
a permission boundary. If the harness cannot enforce a requested restriction,
the driver must refuse the turn before invoking it. OpenCode's refusal of
read-only turns is the shipped example: its working-directory flag is not a
sandbox, so pretending it is read-only would be unsafe.

Call `request.onSpawn(pid)` as soon as a child process exists. The durable
runtime uses the PID when reconciling a daemon crash. Honor `request.signal`,
but do not turn local process termination into a stronger remote-stop claim.

### Event sequence

Every invocation emits a coherent finite sequence:

1. exactly one first `started` event, including a session ID only when one is
   real and reusable;
2. zero or more `heartbeat`, `output`, `reasoning`, `tool`, and `usage` events;
3. exactly one final `settled` event with `completed`, `failed`, or `refused`.

Do not throw for ordinary harness failures such as a missing binary, logout,
quota exhaustion, malformed output, or a non-zero exit. Translate them into a
failed/refused settled event with a useful detail. Never emit events after
settlement.

If `usageReporting` is true, a successful turn must emit a `usage` event. Only
map values the harness actually reports; do not estimate token counts or cost
and present them as measured.

### Sessions and resume

Claim `sessions` only when `started.sessionId` returns a durable harness
identity. Claim `resume` only when `resume(sessionId, request)` continues that
exact conversation. A driver without resume may expose the method for wrapper
compatibility, but it must settle as refused/failed rather than silently start a
fresh turn.

The daemon stores the driver session against an invocation and resumes only a
known later attempt. A session ID is execution metadata, not graph semantics.

### Cancellation

Cancellation has four ordered guarantees:

| Value              | What is proven                                                    |
| ------------------ | ----------------------------------------------------------------- |
| `none`             | No supported interruption                                         |
| `local-process`    | A local process was signalled or killed; remote work may continue |
| `cooperative`      | A stop was requested, but taking effect was not confirmed         |
| `remote-confirmed` | The remote side confirmed work stopped                            |

Only `remote-confirmed` may return `stopped: true`. Codex, Claude Code, and
OpenCode are all capped at `local-process`: terminating their CLI cannot prove
that an already-sent provider request stopped or stopped billing. After an
ambiguous stop, the runtime records an unknown outcome and must not blindly
repeat billable work.

## Implementation paths

### Adapt an existing ProviderAdapter

Prefer `providerDriver(adapter, options)` when a proven adapter already exists.
The compatibility wrapper normalizes event order, converts throws to failed
settlement, maps the permission envelope, supports lifecycle abort/PID reporting,
and permanently caps cancellation at `local-process`.

Only override capabilities the adapter genuinely demonstrates:

```ts
import { providerDriver } from '@roleflock/provider-core';

export function exampleDriver(): AgentDriver {
  return providerDriver(new ExampleAdapter(), {
    capabilities: {
      usageReporting: true,
      toolEvents: true,
      sessions: true,
      resume: true,
    },
  });
}
```

Cancellation cannot be overridden through this wrapper. A hand-written driver
is required for a stronger guarantee, together with a protocol that proves the
remote state.

### Implement the contract directly

Use a direct implementation when the harness protocol does not fit
`ProviderAdapter`, especially a correlated RPC protocol or one with confirmed
remote cancellation. Keep process framing, authentication probes, output
parsing, failure classification, and session handling inside the driver
package. Do not put them in the graph runtime.

For a CLI/RPC driver:

1. resolve an explicit configured binary before a PATH fallback;
2. probe version and authentication independently;
3. construct non-interactive arguments without inheriting permissive user
   defaults;
4. set the child working directory to the leased worktree;
5. apply exact path, command, and network ceilings or refuse;
6. report the PID and parse streaming records incrementally;
7. treat malformed, truncated, uncorrelated, or unexplained output as failure;
8. emit one final settlement; and
9. clean up process/session resources without deleting evidence.

Never put a secret in argv, event payloads, evidence, diagnostics, or generated
project files. Reuse harness-owned login state as described in the
[authentication guide](../integrations/authentication.md).

## Conformance workflow

Import the public source-level runner and supply the smallest request your
driver can execute:

```ts
import { runDriverConformance } from '@roleflock/test-support';

const failures = await runDriverConformance(exampleDriver(), {
  request: (overrides = {}) => ({
    invocationKey: 'inv_conformance',
    objective: 'inspect the failing test',
    workspacePath: fixtureWorktree,
    permissions: { workspaceWrite: true, network: false },
    ...overrides,
  }),
});

expect(failures).toEqual([]);
```

The suite checks detection consistency, event order and settlement, usage and
session claims, real resume behavior, write refusal, and cancellation
truthfulness. It deliberately cannot prove that a harness sandbox confines all
paths or commands; add adversarial escape tests for every permission claim.

Use three test layers:

1. **Deterministic protocol tests** — fake executable/server records exercise
   partial frames, malformed records, stderr/stdout classification, non-zero
   exits, refusal, usage, sessions, and aborts.
2. **Offline conformance** — every normal test run verifies the driver's claims
   without requiring accounts or spending money.
3. **Opt-in live conformance** — a real authenticated CLI exercises the
   integration and coherent event stream.

Repository commands:

```bash
pnpm --filter @roleflock/provider-core test
pnpm --filter @roleflock/test-support test

# May spend a real provider turn; opt in deliberately.
ROFLOCK_LIVE_DRIVER_TESTS=1 pnpm --filter @roleflock/test-support test
```

The live suite skips a harness when its executable is absent. It does not
require successful model output when an account is legitimately out of quota,
but every failure must be classified and explained. Record the exact CLI
version and account mode in release evidence without recording credentials.

## Registering a source-contributed driver

A new bundled driver requires all of these changes:

1. add a focused `packages/provider-<id>` package with adapter/driver and tests;
2. export a factory returning `AgentDriver`;
3. add offline conformance with a realistic fake stream;
4. add an opt-in live fixture only after authentication ownership is clear;
5. register adapter metadata and the driver together in the daemon
   `ProviderRegistry`;
6. add account/readiness probing without importing secrets;
7. expose truthful status through `roflock drivers doctor --json` and Studio;
8. document installation, login, models, permissions, sessions, stop behavior,
   and known limitations; and
9. run build, lint, typecheck, full tests, package smoke, and supported-OS CI.

Do not remove the `ProviderAdapter` compatibility path just because a new
driver exists. Historical and metadata compatibility remains until a dedicated
migration proves it safe to retire.

## Shipped integration status

| Harness     | Public-alpha status                                                     | Important capability facts                                                                                                                                       | Validation                                                                   |
| ----------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Codex CLI   | Registered production driver                                            | Read/write through Codex sandbox; tools and measured usage; no session/resume claim; `local-process` cancellation                                                | Offline conformance plus opt-in real-CLI suite                               |
| Claude Code | Registered production driver                                            | Read-only/plan-mode integration; measured usage; no tools, write, session, or resume claim; `local-process` cancellation                                         | Offline conformance plus opt-in real-CLI suite                               |
| OpenCode    | Registered production driver                                            | Write-capable; tools, usage, session, and true resume; refuses read-only because no enforceable sandbox; permission controls false; `local-process` cancellation | Offline/live conformance, protocol tests, daemon wiring, and portability E2E |
| Pi          | Compatibility spike only; not registered or listed by `roflock drivers` | RPC recommended; initial cancellation ceiling `local-process`; all write, permission, session, usage, and auth claims remain conditional                         | Design/exit criteria only; no shipped `driver-pi`                            |

Cursor Agent and explicit OpenAI-compatible connections also remain supported
through the preserved adapter/driver compatibility path. Query the current
machine rather than assuming readiness:

```bash
roflock drivers doctor --json
```

Its `installed`, `detected`, `authenticated`, and `runnable` fields are separate.
The response also reports the exact capability object used by the runtime.

For invocation examples see [harness invocation](../integrations/harness-invocation.md).
For the Pi protocol decision and missing-driver exit criteria see
[Pi compatibility](../integrations/pi-compatibility.md).

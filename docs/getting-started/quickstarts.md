# Roflock quick starts

These paths use the public `roflock` artifact and the same language, compiler,
Graph IR, and durable runtime used by Studio. The packed-artifact path is the
release-candidate path today; replace it with the npm install command after
`roflock@0.1.0` is published.

## Requirements

- Node.js 24 or newer;
- Git; and
- for live agent work, Codex CLI, Claude Code, or OpenCode installed and
  authenticated as the same operating-system user.

Roflock itself does not require a Cloud account. Keep Studio on loopback and do
not share its handoff URL.

## Install the release candidate

From a Roflock checkout:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --dir apps/cli build

cd apps/cli
npm pack
npm install --global ./roflock-0.1.0.tgz

roflock --version
roflock help --json
```

After npm publication, the equivalent install is:

```bash
npm install --global roflock
```

The artifact provides `roflock`, `roflock-mcp`, and the deprecated
`roleflock` compatibility alias. It does not resolve private workspace
packages from the source checkout.

## Compile without running agents

This path only reads local files. It does not start the daemon, modify a
repository, or contact a provider.

```bash
mkdir roflock-language-demo
cd roflock-language-demo
roflock init

roflock check .roflock/workflows/bugfix.roflock
roflock compile .roflock/workflows/bugfix.roflock \
  --out bugfix.ir.json
roflock validate-ir bugfix.ir.json
roflock hash .roflock/workflows/bugfix.roflock
roflock render .roflock/workflows/bugfix.roflock \
  --out bugfix.mmd
```

The JSON file is canonical Graph IR. The hash identifies normalized workflow
semantics, so comments and formatting do not change it. The Mermaid output is
a view of that same graph contract, not another workflow format.

## Run a deterministic local simulation

Use simulation to learn the complete control flow without provider credentials.
It is deliberately labeled and must never be presented as production evidence.

Create a clean Git repository because Roflock executes writer work in managed
worktrees:

```bash
mkdir roflock-runtime-demo
cd roflock-runtime-demo
git init
git config user.email "you@example.com"
git config user.name "Your Name"
printf '# Roflock runtime demo\n' > README.md
printf '{"private":true,"scripts":{"test":"node -e \\"process.exit(0)\\""}}\n' \
  > package.json
roflock init
git add .
git commit -m "Initialize Roflock demo"
```

Start a simulation daemon, then submit the generated workflow:

```bash
ROFLOCK_FORCE_FAKE=1 roflock daemon start

roflock run .roflock/workflows/bugfix.roflock \
  --repo "$PWD" \
  --brief "Prove the generated workflow end to end" \
  --json
```

Save the returned `graphRunId` and `taskId`. Inspect durable state and events:

```bash
roflock status <graphRunId> --json
roflock events <graphRunId> --after 0 --json
```

When the task reaches `awaiting_acceptance`, finish the explicit human gate:

```bash
roflock accept-task <taskId> --json
roflock status <graphRunId> --json
```

`status` distinguishes graph execution state from operator-facing task state.
While a human node is active, the graph can be `running` and the task
`awaiting_acceptance`; the command exits 5 until the decision is made.

Open the same local runtime in Studio when a visual control surface is useful:

```bash
ROFLOCK_FORCE_FAKE=1 roflock studio
```

The printed URL contains a one-time local session handoff. Keep it private.

Stop only the daemon whose ownership Roflock can prove:

```bash
roflock daemon stop
```

## Run with a live coding harness

Authenticate the harness with its own CLI, then ask Roflock for fresh,
capability-aware readiness:

```bash
roflock daemon start
roflock drivers doctor --json
roflock doctor
```

Do not continue until the selected driver is both `authenticated` and
`runnable`. A detected executable is not proof that authentication, resume, or
remote cancellation works.

Run an authored workflow exactly as in simulation, without
`ROFLOCK_FORCE_FAKE`:

```bash
roflock run .roflock/workflows/bugfix.roflock \
  --repo "$PWD" \
  --brief "Fix the failing parser test" \
  --title "Parser repair" \
  --json
```

Use `status` and `events` for observation; use `pause`, `resume`, and `cancel`
with the exact `graphRunId`. Inspect and decide each pending approval by its
exact ID:

```bash
roflock approvals --run <graphRunId> --json
roflock approval <approvalId> --json
roflock approve <approvalId> --json
```

Agents, drivers, and MCP cannot approve their own work. Final task acceptance
also remains an explicit human command.

## Connect an MCP-capable harness

Configure the harness to start this stdio command:

```text
roflock-mcp
```

MCP v1 exposes only `roflock_check`, `roflock_compile`, `roflock_run`,
`roflock_status`, and `roflock_events`. It reuses the same compiler and daemon
and intentionally has no approve, reject, credential, shell, or arbitrary-file
tool. Copy-paste configurations for Codex, Claude Code, OpenCode, and generic
shell harnesses are in the [harness guide](../integrations/harness-invocation.md).

## Develop from a source checkout

Use the repository gates before claiming a source change is ready:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
ROFLOCK_FORCE_FAKE=1 pnpm test
pnpm format:check
pnpm --dir apps/cli test:package
pnpm build:playground:public
```

The package smoke test creates a tarball, installs it outside the monorepo,
starts its bundled daemon and Studio, executes the workflow generated by
`roflock init`, reads ordered events, performs final human acceptance, and
waits for completion. This is the executable specification for the runtime
quick start above.

## Next references

- [Language reference](../language/reference.md)
- [CLI reference](../cli/reference.md)
- [Runtime operator guide](../runtime/operator-guide.md)
- [Playground and Studio](../ui/playground-and-studio.md)
- [Driver authoring and conformance](../drivers/authoring-and-conformance.md)
- [Security threat model](../security/threat-model.md)

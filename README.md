# Roflock

**AI coding teams as code.**

Roflock is an Apache-2.0 workflow language, compiler, and governed local
runtime for AI coding teams. Write a readable `.roflock` workflow, compile it to
canonical Graph IR, run it through the same durable graph runtime, and retain
the approvals, deterministic checks, events, and evidence that explain what
happened.

Roflock does not replace Codex, Claude Code, Cursor Agent, OpenCode, or another
coding harness. Those tools keep their agent loops and authentication. Roflock
owns the workflow around them: roles, dependencies, bounded repair loops,
worktree coordination, permission ceilings, human gates, verification, and
provenance.

## Release status

The repository is a **public-alpha release candidate** for `roflock@0.1.0`.
The npm artifact, CLI, daemon, Studio, Playground build, arbitrary authored
workflow execution, AgentDriver integrations, MCP server, and documentation are
implemented. Publishing the npm package and deploying the static Playground are
separate maintainer release actions; until then, install the packed artifact
from a checkout.

Public alpha is local and single-user. It is not a hosted multi-tenant service,
and Studio must not be exposed through a public reverse proxy.

## What ships

- `.roflock` 0.1 language, compiler, canonical Graph IR, validator, semantic
  hash, Mermaid renderer, and diagnostics;
- one durable graph runtime with typed failure routing, bounded loops,
  concurrency limits, one writer per worktree, pause/resume/cancel, and crash
  reconciliation;
- first-class CLI for authoring, runs, approvals, evidence, daemon lifecycle,
  diagnostics, drivers, local integrity-locked workflow packages, shell
  completion, and offline Change Passport verification;
- compiler-backed Language Server Protocol support and a source-distributed VS
  Code extension for `.roflock` diagnostics and snippets;
- local authenticated Studio, bundled in the npm artifact;
- browser-only static Playground with no daemon, filesystem, shell, provider,
  credential, or network dependency;
- production drivers for Codex CLI, Claude Code, and OpenCode, plus preserved
  Cursor Agent and OpenAI-compatible integration paths;
- stdio MCP tools for check, compile, run, status, and events; and
- explicit approvals, deterministic verification, evidence chains, usage
  records, backup/restore, redacted diagnostics, and data deletion.

## Install

Requires Node.js 24 or newer and Git. A live agent run also requires at least
one supported coding harness installed and authenticated under the same OS user.

After the package is published:

```bash
npm install --global roflock
roflock --version
roflock doctor
```

From the current checkout:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --dir apps/cli build

cd apps/cli
npm pack
npm install --global ./roflock-0.1.0.tgz
```

The package installs `roflock`, `roflock-lsp`, `roflock-mcp`, and the
deprecated `roleflock` compatibility alias. It is self-contained; consumers do
not install private workspace packages.

## Five-minute local path

Create a safe project scaffold:

```bash
mkdir roflock-demo && cd roflock-demo
git init
printf '# Roflock demo\n' > README.md
git add README.md && git commit -m "Initialize demo"
roflock init
roflock check .roflock/workflows/bugfix.roflock
```

Start the private local control surface:

```bash
roflock studio
```

Open the printed URL, configure a harness on **Providers**, register a Git
repository on **Projects**, then create and operate a task. Keep the URL private:
it contains the one-time daemon-session handoff.

Or start an authored workflow directly:

```bash
roflock daemon start
roflock run .roflock/workflows/bugfix.roflock \
  --repo "$PWD" \
  --brief "Fix the parser regression" \
  --json
```

Use the returned `graphRunId` with `roflock status`, `events`, `pause`, `resume`,
or `cancel`. Human approval commands require one exact pending approval ID;
agents and MCP intentionally cannot approve work for you.

For a deterministic UI demonstration with no provider or real verification:

```bash
ROFLOCK_FORCE_FAKE=1 roflock studio
```

Studio labels this as **Simulation mode**. Its output is never production
evidence.

## Language example

```roflock
workflow bugfix {
  version "1.0.0"
  max_cost 5
}

role builder { write }
role reviewer { readonly }

agent fix {
  role builder
  objective "Implement the approved fix"
}

check test {
  run "npm test"
  required
}

agent review {
  role reviewer
  objective "Review the verified change"
}

human accept {
  title "Accept verified result"
  decisions approve, reject
}

flow {
  fix -> test
  test.pass -> review
  test.fail -> fix { max 3 }
  review -> accept
}
```

The source compiles to immutable Graph IR before execution. A task pins its
exact source, IR, semantic hash, and workflow identity; later edits cannot
change an in-flight run.

## Trust model

- The daemon binds to `127.0.0.1` by default, but loopback is not treated as
  authentication. Token, local-origin, CSRF, and file-permission controls still
  apply.
- Browser code has no generic shell or arbitrary filesystem-read endpoint.
- Every graph is validated, every loop is bounded, and required deterministic
  checks cannot be bypassed on a route to acceptance.
- Models cannot grant their own permissions or approvals. Prompt text is not a
  security boundary.
- Ambiguous billable provider work is not blindly repeated, and killing a local
  CLI is not described as confirmed remote cancellation.
- Repository content leaves the machine only when selected context is sent to
  the provider the operator configured.
- The public Playground is a separate static origin and cannot reach Studio or
  the daemon.

Read the [threat model](docs/security/threat-model.md) and report vulnerabilities
through [GitHub private vulnerability reporting](SECURITY.md), never a public
issue.

## Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/architecture.md)
- [Language reference](docs/language/reference.md)
- [Local workflow packages](docs/workflows/local-packages.md)
- [VS Code and Language Server](docs/editor/vscode.md)
- [CLI reference](docs/cli/reference.md)
- [Runtime operator guide](docs/runtime/operator-guide.md)
- [Playground and Studio guide](docs/ui/playground-and-studio.md)
- [AgentDriver authoring and conformance](docs/drivers/authoring-and-conformance.md)
- [MCP RFC](docs/rfc/RFC-002-ROFLOCK-MCP-V1.md)
- [Control-surface API](docs/integrations/control-surface-api.md)
- [Public-alpha completion authority](docs/implementation/ROFLOCK_PUBLIC_ALPHA_COMPLETION_PLAN_v1.0.md)
- [Launch hardening report](docs/implementation/ROFLOCK_LAUNCH_HARDENING_REPORT_2026-08-09.md)

## Develop

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

Run the source applications in separate terminals:

```bash
pnpm dev             # daemon, 127.0.0.1:4178
pnpm dev:web         # Studio dev server, 127.0.0.1:5173
pnpm dev:playground  # browser-only Playground, 127.0.0.1:5174
```

Use the authenticated URL printed by the daemon, not a bare daemon URL. See
[CONTRIBUTING.md](CONTRIBUTING.md) before changing architecture or compatibility
contracts.

## Open source

Roflock is licensed under [Apache-2.0](LICENSE). The software has no license-key
gates for agent count, graph size, local/self-hosted runs, repositories,
compiler or validator behavior, evidence, replay, security controls, or custom
providers. A future managed service may charge for infrastructure; it cannot
make the self-hosted software intentionally incomplete.

[Contributing](CONTRIBUTING.md) · [Governance](GOVERNANCE.md) ·
[Support](SUPPORT.md) · [Security](SECURITY.md) ·
[Code of Conduct](CODE_OF_CONDUCT.md) · [Release process](docs/release/process.md) ·
[Changelog](CHANGELOG.md)

Historical RoleFlock names remain in specific package namespaces, wire headers,
database filenames, media types, Git refs, and status-check identifiers for
compatibility. They are not the current product name and must not be mass
renamed.

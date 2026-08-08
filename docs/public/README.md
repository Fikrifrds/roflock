# Roflock

**AI coding teams as code.**

Roflock is an open-source workflow language, compiler, and governed local
runtime for coding agents. Keep Codex, Claude Code, Cursor Agent, OpenCode, or a
compatible provider; define how they plan, write, review, verify, retry, and ask
for approval in a readable `.roflock` file.

## Why Roflock

- Source workflows compile to canonical, immutable Graph IR.
- The runtime validates every graph, bounds every loop, and serializes writers.
- Deterministic checks and human approval remain outside model prompts.
- Runs survive daemon restarts and retain ordered events and evidence.
- Drivers report installation, authentication, permissions, sessions, usage,
  and cancellation truthfully.
- The local daemon and Studio do not require a cloud account.
- The public Playground compiles in the browser and cannot access the local
  daemon, shell, filesystem, providers, or credentials.

## Public-alpha surfaces

- **Language** — author `.roflock`, compile/validate/hash/render locally.
- **CLI** — start and control runs, decide approvals, inspect evidence, operate
  the daemon, and expose MCP stdio tools.
- **Studio** — private authenticated control surface bundled with the daemon.
- **Playground** — separately deployed static language explorer.
- **AgentDriver** — production seam for existing coding harnesses.

Roflock is currently a `0.1.0` public-alpha release candidate. See the
[repository README](../../README.md) for the exact installation state and
[documentation index](../README.md) for complete guides.

## Open-source promise

Roflock is Apache-2.0. Agent count, graph size, local/self-hosted runs,
repositories, compiler and validator behavior, evidence, replay, security
controls, and custom providers are not license-gated. Managed infrastructure
may become a service; the software itself remains complete.

## Privacy and security

Read the [privacy summary](privacy.md), [threat model](../security/threat-model.md),
and [security reporting policy](../../SECURITY.md). The product is local-first,
not “nothing ever leaves the machine”: selected prompts/context go to the
provider the operator chooses during a live run.

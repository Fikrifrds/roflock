# Roflock documentation

Roflock is an Apache-2.0 executable workflow language and governed local runtime
for AI coding teams. Start with the user-facing guides below; implementation
plans and RoleFlock-era documents remain available as design history.

## Start here

| Guide                                                                                  | Use it for                                           |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [Quick starts](getting-started/quickstarts.md)                                         | Compile, simulate, run live, MCP, source development |
| [Architecture](architecture.md)                                                        | One-runtime pipeline, trust boundaries, package map  |
| [Language reference](language/reference.md)                                            | Exact `.roflock` 0.1 syntax and semantics            |
| [Local workflow packages](workflows/local-packages.md)                                 | Versioned, integrity-locked local reusable workflows |
| [VS Code and LSP](editor/vscode.md)                                                    | Editor diagnostics, extension, and local-only trust  |
| [CLI reference](cli/reference.md)                                                      | Install, commands, JSON, exits, troubleshooting      |
| [Runtime operator guide](runtime/operator-guide.md)                                    | Data, recovery, approvals, backup, upgrades          |
| [Playground and Studio](ui/playground-and-studio.md)                                   | Browser surfaces, use, deployment, security bounds   |
| [Driver authoring](drivers/authoring-and-conformance.md)                               | AgentDriver contract, conformance, harness status    |
| [Public-alpha completion](implementation/ROFLOCK_PUBLIC_ALPHA_COMPLETION_PLAN_v1.0.md) | Exact readiness authority and release gates          |
| [Public-alpha release audit](implementation/ROFLOCK_PUBLIC_ALPHA_RELEASE_AUDIT.md)     | Commit review, gate evidence, residual risk          |
| [Executed release checklist](release/public-alpha-checklist.md)                        | Local evidence and remaining operator actions        |
| [Control-surface API](integrations/control-surface-api.md)                             | Authenticated local client integration               |
| [Harness invocation](integrations/harness-invocation.md)                               | Codex, Claude Code, OpenCode, Pi/shell entry points  |
| [Authentication](integrations/authentication.md)                                       | Harness-owned login and BYOK boundaries              |
| [CLI exit codes](cli/exit-codes.md)                                                    | CI-safe process and JSON error behavior              |
| [Threat model](security/threat-model.md)                                               | Local daemon, repository, provider, evidence risks   |
| [Supply chain](security/supply-chain.md)                                               | SBOM, CI security, container, Dev Container          |
| [Playground boundary](security/playground-local-runtime.md)                            | Why the public site cannot run local agents          |
| [Crash recovery](crash-recovery.md)                                                    | Operator recovery and safe continuation              |
| [Contributing](../CONTRIBUTING.md)                                                     | Setup, invariants, tests, compatibility, PR evidence |
| [Governance](../GOVERNANCE.md)                                                         | Roles, decisions, releases, maintainership           |
| [Support](../SUPPORT.md)                                                               | Issue routing, diagnostics, safe reports             |
| [Security reporting](../SECURITY.md)                                                   | Private vulnerability scope and process              |
| [Release process](release/process.md)                                                  | Version, gates, npm OIDC, Playground deployment      |

## Public contracts

- [RFC-001: Graph IR v1](rfc/RFC-001-ROFLOCK-GRAPH-IR-V1.md)
- [RFC-002: Roflock MCP v1](rfc/RFC-002-ROFLOCK-MCP-V1.md)
- `roflock help --json` — installed CLI automation and exit-code contract
- authenticated `GET /api/control/v1` — local control-surface discovery

## Implementation authority

Read in this order before changing architecture:

1. root [`AGENTS.md`](../AGENTS.md);
2. [open-source PRD](prd/ROFLOCK_OPEN_SOURCE_PRD_v1.0.md);
3. [evolution plan](implementation/ROFLOCK_EVOLUTION_IMPLEMENTATION_PLAN_v1.0.md);
4. [repository audit](implementation/ROFLOCK_REPO_AUDIT.md);
5. [public-alpha completion plan](implementation/ROFLOCK_PUBLIC_ALPHA_COMPLETION_PLAN_v1.0.md);
6. accepted [RFCs](rfc/) and relevant [ADRs](adr/).

The repository audit and completion plan outrank older planning claims when they
disagree with the checkout. No phase is complete from narrative alone; tests,
commits, compatibility impact, and unresolved risk are required.

## Historical material

`docs/product/roleflock_*` and the `roflock-ai-coding-handoff-v1.0/` source
handoff are retained intentionally. They explain the proven runtime/governance
foundation and migration intent, but are not current installation or product
documentation.

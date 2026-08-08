# Roflock documentation

Roflock is an Apache-2.0 executable workflow language and governed local runtime
for AI coding teams. Start with the user-facing guides below; implementation
plans and RoleFlock-era documents remain available as design history.

## Start here

| Guide                                                                                  | Use it for                                          |
| -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [Architecture](architecture.md)                                                        | One-runtime pipeline, trust boundaries, package map |
| [Language reference](language/reference.md)                                            | Exact `.roflock` 0.1 syntax and semantics           |
| [CLI reference](cli/reference.md)                                                      | Install, commands, JSON, exits, troubleshooting     |
| [Runtime operator guide](runtime/operator-guide.md)                                    | Data, recovery, approvals, backup, upgrades         |
| [Public-alpha completion](implementation/ROFLOCK_PUBLIC_ALPHA_COMPLETION_PLAN_v1.0.md) | Exact readiness authority and release gates         |
| [Control-surface API](integrations/control-surface-api.md)                             | Authenticated local client integration              |
| [Harness invocation](integrations/harness-invocation.md)                               | Codex, Claude Code, OpenCode, Pi/shell entry points |
| [Authentication](integrations/authentication.md)                                       | Harness-owned login and BYOK boundaries             |
| [CLI exit codes](cli/exit-codes.md)                                                    | CI-safe process and JSON error behavior             |
| [Threat model](security/threat-model.md)                                               | Local daemon, repository, provider, evidence risks  |
| [Playground boundary](security/playground-local-runtime.md)                            | Why the public site cannot run local agents         |
| [Crash recovery](crash-recovery.md)                                                    | Operator recovery and safe continuation             |

Studio/Playground, driver-authoring, contributor/governance/release, and
executable quick-start guides are tracked as RF-DOCS-005 through RF-DOCS-008 in
the completion plan and linked here as they land.

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

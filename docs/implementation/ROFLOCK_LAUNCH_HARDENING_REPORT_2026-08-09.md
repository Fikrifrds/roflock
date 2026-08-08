# Roflock launch hardening report — 9 August 2026

## Scope and conclusion

This report records the launch-hardening work added after the public-alpha
release audit at commit `041f4ab`. The repository remains a **local,
single-user public-alpha release candidate**. The additions improve authoring,
operator ergonomics, learning, supply-chain visibility, reusable workflows,
and local benchmark reporting without adding a second runtime, a hosted
service, or unverified remote-package semantics.

All local release gates are to be rerun after this report is committed. The
remaining public-release actions require maintainer credentials or an external
deployment target and are deliberately not represented as complete here.

## Delivered improvements

| Area                     | Delivered behavior                                                                                                                                           | Boundary preserved                                                                                                 | Evidence                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Editor                   | `roflock-lsp` implements compiler-backed diagnostics and compile requests over stdio LSP; the VS Code extension is source-distributed.                       | The language compiler remains the only source of diagnostics and semantic truth.                                   | `14601a7`; `docs/editor/vscode.md`            |
| CLI                      | `explain`, `dry-run`, shell completions, and durable `logs --follow` make workflows and runs easier to inspect.                                              | `dry-run` is compiler-only; it cannot start a daemon, driver, command, or approval. Logs read durable events only. | `02812db`; `docs/cli/reference.md`            |
| Playground               | Browser users can import/download local source and inspect canonical Graph IR.                                                                               | No network, provider, daemon, filesystem API, or local runtime bridge was added.                                   | `493a43f`; `docs/ui/playground-and-studio.md` |
| Supply chain             | Dependabot, CodeQL, production-dependency audit, CycloneDX SBOM generation/validation, compiler-only Docker image, and Dev Container are checked in.         | The container does not expose the daemon or turn local Studio into a public service.                               | `85b9c5b`; `docs/security/supply-chain.md`    |
| Reusable workflows       | Local packages compile every declared source, lock SHA-256 source integrity and semantic hashes, copy only declared files, and reject path escapes/symlinks. | No registry, URL, hook, package script, implicit update, or arbitrary executable payload is accepted.              | `57746d5`; `docs/workflows/local-packages.md` |
| Installation reliability | Package directory and lockfile writes are staged and atomically published; failed lock writes remove the untracked target.                                   | A source package is not considered installed without its matching lock record.                                     | `55642d0`; CLI typecheck and 114 CLI tests    |
| Quality signal           | The local benchmark now reports median and p95 and uses Roflock product terminology.                                                                         | It remains a local fixture, explicitly not a provider or end-to-end marketing benchmark.                           | `8de5655`; `docs/benchmarks/baseline.md`      |

## Public documentation map

| Audience                 | Start here                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evaluator / first user   | [Quick starts](../getting-started/quickstarts.md), [CLI reference](../cli/reference.md), [Playground and Studio](../ui/playground-and-studio.md)          |
| Workflow author          | [Language reference](../language/reference.md), [local workflow packages](../workflows/local-packages.md), [VS Code and LSP](../editor/vscode.md)         |
| Operator                 | [Runtime operator guide](../runtime/operator-guide.md), [security supply chain](../security/supply-chain.md), [threat model](../security/threat-model.md) |
| Contributor / maintainer | [Contributing](../../CONTRIBUTING.md), [release process](../release/process.md), [public-alpha checklist](../release/public-alpha-checklist.md)           |

## Intentional deferrals and external release actions

The following are not local code gaps that can safely be completed without a
maintainer or deployment authority:

1. push the branch and create/review a pull request;
2. verify GitHub Actions on Linux and Windows;
3. configure npm package ownership, trusted publishing/OIDC, and provenance;
4. create a signed tag, publish the package, and create the GitHub Release;
5. deploy the static Playground to its separate public origin; and
6. design remote workflow-package distribution with immutable references,
   signatures/trust roots, revocation, provenance, private-registry support,
   and an explicit retrieval consent flow.

These are tracked by the [executed public-alpha
checklist](../release/public-alpha-checklist.md). A public announcement must not
say that any item above is done until independent evidence exists.

## Compatibility and architecture review

No persisted graph meaning, runtime scheduler path, historical RoleFlock
identifier, environment-variable fallback, database filename, wire header, or
package namespace was removed. All workflows still compile to canonical Graph
IR and execute only through the established graph runtime. New CLIs are
additive; `roleflock` stays as the deprecated compatibility alias.

The project still needs the normal release gates named in `AGENTS.md` and the
release checklist. This report is an evidence index, not a substitute for those
commands or for external release approval.

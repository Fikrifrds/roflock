# Contributing to Roflock

Thank you for improving Roflock. Contributions are welcome for the language,
compiler, runtime, CLI, Studio, Playground, drivers, tests, security, and docs.
Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before opening work

For a bug, search existing issues and include a minimal reproduction. For a
feature, describe the user problem and compatibility impact before a large
implementation. Security vulnerabilities follow [SECURITY.md](SECURITY.md) and
must not be filed publicly.

Architecture changes should start from the
[open-source PRD](docs/prd/ROFLOCK_OPEN_SOURCE_PRD_v1.0.md),
[repository audit](docs/implementation/ROFLOCK_REPO_AUDIT.md), accepted RFCs,
and relevant ADRs. The checkout and current tests outrank stale planning prose.

## Development setup

Requirements:

- Node.js 24 or newer;
- pnpm 11.17.0 through Corepack;
- Git; and
- macOS, Linux, or Windows for normal compiler/CLI work. Driver support may be
  OS-specific and must say so.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Provider CLIs are not required for normal tests. Live driver tests are opt-in
because they may spend a real provider turn:

```bash
ROFLOCK_LIVE_DRIVER_TESTS=1 pnpm --filter @roleflock/test-support test
```

## Change discipline

Use the repository's evolution order:

```text
KEEP → ADAPT → GENERALIZE → REPLACE
```

Do not create a second graph runtime, put execution in the compiler, make
Studio's JSON a competing workflow language, or remove historical compatibility
to simplify new code. One ticket should produce one logical commit whose
subject begins with the ticket ID. Keep unrelated formatting and rebranding out
of behavioral changes.

When changing a package, identify its current responsibility, protected tests,
RoleFlock-specific assumptions, and compatibility surface first. New public
semantics need an RFC or ADR when existing contracts do not already authorize
them.

## Non-negotiable invariants

- Every graph is validated before execution; every loop is bounded.
- Required deterministic verification cannot be bypassed on the path to
  acceptance.
- Writer execution is serialized per task worktree.
- Models cannot grant their own permissions or approve protected work.
- Prompt text is not a security boundary.
- Human approval is explicit and bound to the exact requested action.
- Confirmed progress survives restart; unknown billable work is not blindly
  repeated.
- Driver capability claims are truthful. Only remotely confirmed cancellation
  may be reported as stopped.
- The daemon remains loopback-only and exposes no generic shell or arbitrary
  filesystem-read API.
- The public Playground remains unable to reach the daemon, local files,
  credentials, providers, or execution.
- Open-source capability is not gated by a license key or paid tier.

## Compatibility

Do not casually rename or reinterpret persisted/public identifiers. The main
compatibility inventory includes:

- `ROLEFLOCK_*` environment fallbacks and `~/.roleflock`;
- `roleflock.db` and historical graph/version IDs;
- `@roleflock/*` internal package names;
- `x-roleflock-*` headers and the `roleflock_token` cookie;
- exported Change Passport media types;
- `refs/roleflock/*`, event identifiers, and GitHub status-check codes; and
- the deprecated `roleflock` executable alias.

New copy and preferred configuration should say Roflock/`ROFLOCK_*`. A
compatibility migration must support old and new forms explicitly and include
round-trip tests.

## Tests and release gates

Before requesting review, run:

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
git diff --check
pnpm --dir apps/cli test:package
```

Add targeted tests for the changed contract. Language changes need parser,
diagnostic, semantic-hash, and runtime-bridge coverage. Runtime changes need
recovery and durable-event coverage. Driver changes need protocol tests,
`runDriverConformance`, permission escape tests, and truthful interruption.
Studio/Playground changes need browser behavior and production-build checks.

If a gate fails on the target branch, record the exact baseline and prove the
change did not add failures. Do not hide or relabel a failing gate as success.

## Pull request description

Include:

- problem and ticket/RFC/ADR;
- changed files and public behavior;
- preserved invariants;
- exact test commands and results;
- compatibility impact and migration behavior;
- security/privacy impact;
- screenshots for material UI changes; and
- unresolved risks or deliberately deferred work.

Reviewers may ask to split a change when behavior, rebranding, formatting, or
unrelated refactors make its evidence difficult to verify.

## Documentation

Update user-facing docs in the same change as a public contract. Keep examples
executable, distinguish implemented behavior from proposals, and preserve
historical RoleFlock documents as labeled history rather than silently
rewriting them.

## Licensing

Roflock is licensed under Apache-2.0. Under section 5 of that license, unless
you explicitly state otherwise, a contribution intentionally submitted for
inclusion is provided under the same terms. The project currently requires no
separate CLA or DCO sign-off.

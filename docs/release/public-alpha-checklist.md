# Public-alpha release checklist

**Candidate:** `roflock@0.1.0`

**Repository state tested:** `49f8fe3` on `roflock-evolution-r0`

**Decision:** repository-side release candidate ready; public release not yet
published or deployed

**Executed:** 9 August 2026 on macOS arm64, Node.js 24.15.0, pnpm 11.17.0

This is the evidence record for RF-DIST-013. A checked item was executed against
the candidate above. An unchecked item is an explicit maintainer action, not an
implicit claim.

## Source and release identity

- [x] Working tree was clean before release verification.
- [x] Candidate version is `0.1.0` and the tag verifier accepts `v0.1.0`.
- [x] License is Apache-2.0 and the packed package contains its README and
      license.
- [x] The audited range contains no merge commit or `Co-authored-by` trailer.
- [x] `git fsck --no-dangling --no-progress` succeeds.
- [x] Conflict-marker, TODO/FIXME, accidental skipped-test, and credential scans
      found no release blocker. Deliberate redaction fixtures and generated test
      keys remain confined to tests.
- [ ] Push the candidate branch and review it through the protected default
      branch.
- [ ] Rename or transfer the GitHub repository from the current RoleFlock URL,
      or reconcile public package metadata before release.

## Required local gates

| Gate                             | Result                                                       |
| -------------------------------- | ------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | passed; lockfile already current                             |
| `pnpm build`                     | passed for all packages, daemon, CLI, Studio, and Playground |
| `pnpm lint`                      | passed with no warning suppression debt                      |
| `pnpm typecheck`                 | passed for all 34 projects                                   |
| `pnpm test`                      | 940 passed, 12 opt-in live-driver tests skipped              |
| `pnpm format:check`              | passed                                                       |
| working-tree `git diff --check`  | passed                                                       |
| documentation link check         | 76 Markdown files; all local links resolve                   |
| `pnpm build:playground:public`   | passed with the `/play/` base                                |
| release tag/version verifier     | passed for `v0.1.0`                                          |

Historical Markdown in the full `main..candidate` range contains intentional
trailing spaces used as Markdown hard line breaks. The current formatting gate
and working-tree whitespace gate are clean.

## Packed npm artifact

- [x] `pnpm --dir apps/cli test:package` passes outside the monorepo.
- [x] Artifact identity: `roflock@0.1.0`, 1,460,062 packed bytes, 6,844,638
      unpacked bytes, 41 entries.
- [x] The artifact contains the public CLI, deprecated compatibility bin, MCP
      bin, bundled daemon, Studio, built-in workflows, README, and license.
- [x] The clean-install smoke executes manifest and content checks, install,
      version, help, language check, project initialization, MCP stdio, Studio
      HTTP handoff, authored run, status/events, and final task acceptance.
- [x] No private `workspace:*` dependency is required by a consumer.
- [x] macOS arm64 package smoke passes.
- [ ] Linux package smoke passes on the pushed candidate.
- [ ] Windows package smoke passes on the pushed candidate.

The Linux/macOS/Windows matrix is configured in `.github/workflows/package.yml`.
The two unchecked operating systems cannot be claimed before the branch is
pushed and those jobs complete.

## Runtime, drivers, and security

- [x] Deterministic runtime E2E, forced-restart recovery, and two-driver
      portability are covered by the green suite.
- [x] `.roflock` source compiles to canonical Graph IR and reaches the one
      existing `runGraph` runtime through the compatibility bridge.
- [x] Authored task source, executable graph, semantic hash, and integrity hash
      are immutable after creation.
- [x] Unsupported authority, retry, custom-decision, effect, driver, schema, and
      timeout semantics fail closed.
- [x] Approval and final task decisions require explicit stable identifiers.
- [x] Cancellation reporting is limited to the selected driver's proven
      capability.
- [x] SQLite backup is transactionally consistent and operational reset removes
      provider credentials plus runner-signing secrets.
- [x] Offline driver conformance passes for shipped drivers.
- [ ] Record opt-in live conformance for each advertised external CLI version.

The 12 skipped tests require authenticated third-party CLIs and may spend
provider turns. They are not silently treated as passing.

## Playground and Studio

- [x] Production builds pass.
- [x] Desktop and 390×844 mobile layouts were inspected with no horizontal
      overflow.
- [x] Playground example switching, compilation, diagnostics, diagram updates,
      and fragment-only share links work without console errors.
- [x] Invalid source shows a typed diagnostic and no partial graph.
- [x] Playground is browser-only and its zero-fetch boundary is tested.
- [x] Studio onboarding, command center, project registration, task creation,
      Providers, and Privacy surfaces were inspected.
- [x] Simulation copy states that agent turns, code changes, and verification are
      scripted while local provider discovery may remain real.
- [ ] Deploy `apps/playground/dist/` to the documented HTTPS `/play/` origin.
- [ ] Verify production CSP/security headers, asset caching, fragment round
      trips, and Studio's `VITE_PLAYGROUND_URL` against the deployed origin.

## Publish and post-release

- [ ] Prove control of the unscoped npm package name. `npm view roflock` returned
      `E404` during this audit; absence is not ownership proof.
- [ ] Configure and verify npm trusted publishing for
      `.github/workflows/publish-npm.yml`.
- [ ] Obtain green required GitHub checks on Linux, macOS, and Windows.
- [ ] Create and push the signed `v0.1.0` tag.
- [ ] Verify npm provenance, integrity, and a registry install independently.
- [ ] Create the GitHub release from the same tag.
- [ ] Deploy and smoke-test the public Playground.
- [ ] Monitor installation, driver, security, and compatibility reports.

If a gate fails, do not republish the same version locally. Stop rollout, fix the
candidate in a new reviewed commit, rerun the full matrix, and follow the
[release process](process.md) for patching, deprecation, or incident response.

# Release process

This is the maintainer runbook for a public Roflock release. A green checkout
is release-ready; publishing npm, creating a GitHub release, and deploying the
Playground are explicit external actions.

## Version policy

Roflock follows Semantic Versioning. Before 1.0:

- patch releases fix defects without intentionally breaking the current minor
  contract;
- minor releases may change public contracts, but must document migrations and
  preserve persisted historical meaning where promised; and
- prereleases use a SemVer suffix such as `0.2.0-alpha.1`.

The release tag must be exactly `v<apps/cli package version>`. The publish
workflow rejects a mismatch.

## One-time repository setup

Before the first npm release, a maintainer must verify:

- the unscoped `roflock` package name is controlled by the project;
- npm trusted publishing is configured for
  `.github/workflows/publish-npm.yml` and the expected GitHub environment;
- GitHub tag/repository permissions and private vulnerability reporting are
  enabled;
- protected-branch checks include CI and package smoke; and
- the public Playground HTTPS origin and deployment owner are documented.

The workflow requests only `contents: read` and `id-token: write`; no long-lived
`NPM_TOKEN` is required. `npm publish` is reached only on a matching pushed tag.
A manual workflow dispatch validates but intentionally does not publish.

## Prepare the release

1. Start from an up-to-date, clean release commit.
2. Choose the version and update `apps/cli/package.json`.
3. Update `CHANGELOG.md`: move relevant Unreleased entries under the version
   with the release date and fix comparison links.
4. Update docs/examples for every public contract change.
5. Confirm compatibility and migration notes, supported OS/Node versions,
   driver limitations, security advisories, and known issues.
6. Confirm the completion plan has no open release blocker.

Do not change the version after testing without rerunning the package gates;
the manifest is embedded into the artifact and CLI output.

## Required gates

From a clean checkout with Node 24 and the pinned pnpm version:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
ROFLOCK_FORCE_FAKE=1 pnpm test
pnpm format:check
git diff --check
pnpm --dir apps/cli test:package
pnpm build:playground:public
```

Then inspect the artifact rather than assuming package metadata:

```bash
cd apps/cli
npm pack --dry-run
npm pack
npm install --global ./roflock-<version>.tgz
roflock --version
roflock help --json
roflock doctor --json
```

Package smoke must pass on Linux, macOS, and Windows CI. It verifies manifest
closure, install, CLI entries, compiler, scaffold, MCP stdio, daemon lifecycle,
and bundled Studio HTTP. Live driver conformance is optional for normal CI but
should be recorded for each advertised CLI version before a significant driver
release:

```bash
ROFLOCK_LIVE_DRIVER_TESTS=1 pnpm --filter @roleflock/test-support test
```

These tests may spend provider turns and require authenticated accounts.

## Publish

After the release commit is reviewed and CI is green:

```bash
git tag -s v<version> -m "Roflock v<version>"
git push origin v<version>
```

The tag starts `.github/workflows/publish-npm.yml`, repeats all release gates,
checks tag/version equality, and publishes `apps/cli` with npm provenance via
OIDC. Do not run a second local `npm publish` after the workflow succeeds.

Verify independently:

```bash
npm view roflock@<version> name version dist.integrity dist.tarball
npx --yes roflock@<version> --version
```

Create a GitHub release from the same tag with changelog highlights, install and
upgrade commands, compatibility notes, known limitations, and security credits.
Attach generated checksums/artifacts only when their provenance is clear.

## Playground

The npm release includes Studio but does not deploy the public Playground.
Build and deploy it separately:

```bash
pnpm build:playground:public
```

Publish `apps/playground/dist/` to the HTTPS `/play/` origin using the security
headers in the [Playground/Studio guide](../ui/playground-and-studio.md). Verify
asset paths, zero runtime/network integration, share-fragment round trips, CSP,
and the production Studio `VITE_PLAYGROUND_URL` link. Record the deployed commit
and invalidate only the necessary caches.

## After release

- install from the public registry on a clean machine;
- launch `roflock studio`, compile an example, and run a deterministic smoke;
- verify docs and changelog links;
- monitor issues, advisories, and package provenance; and
- open the next Unreleased section when work resumes.

Do not unpublish a broken version except for a severe security/legal reason.
Deprecate it with an npm message, publish a fixed patch, and document upgrade
steps. For a compromised release, stop normal rollout, revoke affected
credentials/keys, publish an advisory, and follow the security process.

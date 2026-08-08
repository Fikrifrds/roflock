# Supply chain and reproducible artifacts

Roflock treats the published `roflock` npm tarball as the public executable
artifact. Workspace packages are bundled into that artifact; consumers must not
need a private `@roleflock/*` package or this repository at install time.

## Automated checks

- Dependabot proposes npm and GitHub Actions updates weekly.
- CodeQL analyzes JavaScript and TypeScript on pushes, pull requests, and a
  weekly schedule.
- The Supply chain workflow audits production dependencies at high severity or
  above, generates a CycloneDX 1.5 SBOM, validates its shape, and uploads it as
  a CI artifact.
- Package smoke installs the packed CLI outside the monorepo and exercises its
  compiler, MCP, Studio handoff, and deterministic runtime path.

Generate the SBOM locally after `pnpm install`:

```bash
node scripts/generate-sbom.mjs --out artifacts/roflock.cdx.json
node scripts/verify-sbom.mjs artifacts/roflock.cdx.json
```

The generator asks pnpm for the production dependency tree of the public
`roflock` package, excludes workspace links, and records the external package
relationships in CycloneDX. It deliberately does not invent integrity hashes
that the package manager did not report.

## Container and development environment

`Dockerfile` builds an npm artifact and exposes a compiler-only `roflock` image:

```bash
docker build -t roflock:local .
docker run --rm -v "$PWD:/workspace" -w /workspace roflock:local check workflow.roflock
```

The image intentionally does not expose or bind the daemon. Publishing a local
daemon through a container port would change Roflock's loopback/session trust
boundary and requires a separate security design; it is not presented as
self-hosted remote control.

`.devcontainer/devcontainer.json` provides Node 24, Git, pinned pnpm setup, and
the normal formatter/test extensions for contributors. It does not install
provider credentials or make provider calls.

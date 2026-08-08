# Local workflow packages

Roflock workflow packages make reusable `.roflock` source explicit without
turning a registry download into an unreviewed execution path. Version 0.1
supports validated **local directories**. Git URLs, remote registries, hooks,
and arbitrary package scripts are intentionally not accepted yet.

## Package layout

```text
review-workflows/
├── roflock.workflow.json
└── workflows/
    └── secure-review.roflock
```

`roflock.workflow.json` is a small JSON manifest:

```json
{
  "schemaVersion": 1,
  "name": "review-workflows",
  "version": "1.2.3",
  "description": "Reusable code-review workflows",
  "workflows": ["workflows/secure-review.roflock"]
}
```

Names use lowercase letters, digits, dots, underscores, and hyphens. Versions
must be SemVer. Every listed path must be a relative `.roflock` file inside the
package. Each workflow is compiled before installation.

## Validate, install, and inspect

```bash
roflock workflow validate ./review-workflows
roflock workflow install ./review-workflows --project /path/to/repository
roflock workflow list --project /path/to/repository
```

Validation reports workflow IDs and semantic hashes. Installation copies only
the declared manifest and `.roflock` sources to:

```text
<project>/.roflock/packages/<name>/<version>/
```

It writes `<project>/.roflock/roflock-workflows.lock.json` with the source
location, version, source-content SHA-256 integrity hash, and workflow semantic
hashes. The same package/version/integrity is idempotent. A conflicting lock or
pre-existing target fails closed; this early protocol has no implicit update or
overwrite operation.

Installed source is still source code to review. Run a selected file explicitly,
for example:

```bash
roflock run \
  /path/to/repository/.roflock/packages/review-workflows/1.2.3/workflows/secure-review.roflock \
  --repo /path/to/repository \
  --brief "Review the authentication change"
```

Roflock snapshots the compiled workflow at task creation. Updating an installed
package later cannot mutate a task already created from it.

## Why remote installation is absent

A URL that names a workflow also names an untrusted source distribution. Safe
remote installation needs an accepted design for immutable references, content
hashes, signatures/trust roots, revocation, provenance, local/private registry
operation, and an explicit user decision before retrieval. Until then, clone or
obtain source through your own reviewed process, validate it locally, and install
the directory. This preserves the open-source and local-first model without
pretending that a package registry is just a convenience feature.

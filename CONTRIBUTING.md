# Contributing

Use pnpm and Node 24+.

Before opening a change, run:

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

`pnpm format:check` currently fails on a set of files that predate the Roflock
migration. Compare against the list recorded in
[`docs/implementation/ROFLOCK_REPO_AUDIT.md`](docs/implementation/ROFLOCK_REPO_AUDIT.md)
§1.1 rather than expecting a clean exit, and do not fold a bulk reformat into a
change that alters behaviour.

## Invariants

These are not style preferences. A change that weakens one needs an ADR, not a
review comment.

- Every graph is validated before it executes, and every loop is bounded.
- Writer execution is serialised per worktree; one lease, one writer.
- Deterministic verification is first class. A required check cannot be
  bypassed on the way to acceptance.
- Models cannot grant their own permissions. Prompt text is not a security
  boundary; role and artifact authority is enforced outside the model.
- Human approval is explicit.
- Source code stays local unless the configured provider receives selected
  context.
- Restart recovery preserves confirmed progress, and ambiguous billable work is
  never blindly repeated.
- Capabilities are reported truthfully. Unknown stays unknown — in particular,
  do not report work as cancelled unless it demonstrably stopped.
- The daemon stays loopback-only. Do not add a generic shell or filesystem API.
- State changes are durable events or control commands, not in-memory only.

## Open source without capability gates

Roflock is open-source first. Do not add a licence check that limits agents,
graph size, nodes, local or self-hosted runs, or repositories; and do not make
compiler checks, validators, evidence, replay, self-hosted access control, or
custom providers conditional on a paid tier. Managed infrastructure may be a
paid service. Permission to use the software's own capabilities may not be.

## Compatibility

The repository is mid-migration from RoleFlock to Roflock. Persisted things
outlive the rename and may not be broken casually: the SQLite schema, pinned
graph version ids, `ROLEFLOCK_*` environment variables, `~/.roleflock`, exported
Change Passport media types, and published GitHub status-check codes. Prefer
`ROFLOCK_*` with a legacy fallback over a rename, and see the audit for the full
inventory.

## Commits

One ticket, one logical commit, with the ticket id first in the subject. Keep
rebranding out of commits that change behaviour, and keep unrelated formatting
out of both.

## Licensing of contributions

Roflock is licensed under Apache-2.0. By submitting a contribution you agree it
is licensed under those terms, per section 5 of the licence.

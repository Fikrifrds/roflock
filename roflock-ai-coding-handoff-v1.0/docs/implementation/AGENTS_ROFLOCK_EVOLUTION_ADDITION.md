# AGENTS.md addition — Roflock evolution guardrails

Add/merge this section into the repository's root `AGENTS.md`.

## Roflock evolution rule

This repository is an evolution of an existing working RoleFlock implementation.

Never assume the old runtime should be replaced.

For existing code use:

```text
KEEP → ADAPT → GENERALIZE → REPLACE
```

in that order.

Replacement requires evidence that the existing implementation cannot satisfy the new public contract safely.

## Preserve proven subsystems

Preserve and evolve:

- graph runtime;
- retry/failure routing;
- writer serialization;
- repository/worktree runtime;
- run control/recovery;
- approvals;
- policy;
- evidence/change passport;
- context compiler;
- provider process integration;
- usage ledger.

Do not create a second competing graph runtime.

## Roflock source pipeline

All authoring surfaces must converge on:

```text
.roflock
→ parser/AST
→ compiler
→ Graph IR
→ validator
→ runtime
```

Studio/playground must not invent private workflow semantics.

## Historical compatibility

Do not silently change the meaning of persisted graph versions.

Do not delete compatibility for old:

- graph version IDs;
- environment variables;
- data directories;
- config names;
- persisted evidence/events;

without an explicit migration.

## Workflow template migration

Built-in TypeScript graphs are migration sources and historical compatibility data.

Move new task creation gradually to compiled `.roflock` templates.

For every migrated template, add semantic-equivalence/regression fixtures.

## Package namespace rebrand

Do not mass rename `@roleflock/*` while performing semantic migration.

First determine whether packages are externally consumed. Rename namespace in a dedicated migration with green tests.

## Ticket completion

Every ticket must report:

- changed files;
- preserved behaviors;
- new behavior;
- tests executed;
- exact results;
- compatibility impact;
- unresolved risks.

No milestone is complete based only on the implementing agent's narrative.

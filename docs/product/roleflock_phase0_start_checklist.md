# RoleFlock Phase 0 Start Checklist

## Objective

Prove one safe, durable, observable vertical slice before building the full dashboard.

```text
Create bug-fix task
→ planner reads repository
→ typed confirmation if needed
→ writer edits isolated worktree
→ deterministic test
→ independent verifier
→ human approval
```

## Required implementation order

1. Monorepo and local daemon bound to `127.0.0.1`.
2. SQLite event store, reducers, snapshots, and idempotency keys.
3. Repository registration and Git worktree manager.
4. Runtime lease, heartbeat, process tree, stop, force terminate, and reconciliation.
5. Generic provider invocation event contract.
6. One planner adapter.
7. One writer adapter.
8. One deterministic test node.
9. One verifier adapter.
10. Typed ConfirmationRequest and Approval Inbox.
11. Active-run UI showing role, provider, configured model, phase, heartbeat, cost, and controls.
12. Forced daemon restart and recovery test.
13. Usage ledger and disclosure manifest.
14. Final evidence bundle.

## Mandatory tests

- Browser cannot execute arbitrary commands.
- Daemon binds only to localhost by default.
- Two writers cannot own one worktree.
- Secret and symlink escape attempts are denied.
- Stop acknowledgement is durable.
- Force termination removes RoleFlock-owned child processes.
- Dirty worktree is preserved and inspectable after interruption.
- Approval survives browser refresh and daemon restart.
- Changed action fingerprint requires a new approval.
- Unknown paid invocation outcome is not automatically retried.
- Active role/provider/model is never inferred from model self-identification.
- Cloud invocation records selected context and exclusions.
- Required deterministic failure cannot be overruled by a model reviewer.

## Phase 0 exit gate

Phase 0 passes only when:

- a small real repository task completes;
- one forced daemon restart occurs mid-run;
- no confirmed work or approval is lost;
- no duplicate paid invocation occurs;
- no orphaned writer process remains;
- final diff, tests, review, costs, and disclosure manifest are inspectable.

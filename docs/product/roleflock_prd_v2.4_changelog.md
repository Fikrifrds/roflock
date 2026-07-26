# RoleFlock PRD v2.4 Changelog

**Date:** 26 July 2026  
**Status:** Final development-start baseline.

## Added

- User-facing task-intent chooser.
- `new_product` and `review_changes` task types.
- Optional PRD, implementation plan, architecture, API, wireframe, screenshot, ticket, and reference inputs.
- Document authority levels and blocking conflict resolution.
- New-product planning, approval, and milestone decomposition graph.
- Explicit browser → local daemon → user CLI architecture.
- User-owned CLI authentication and local storage boundary.
- Subscription-first, capability-driven routing.
- Claude Code, Codex App Server/CLI, Cursor CLI, and Custom Provider integration strategy.
- Cursor external-sandbox and permission-envelope requirement.
- Project provider disclosure grants and per-invocation disclosure manifest.
- Honest local-first privacy language.
- Typed local knowledge relationships and post-MVP knowledge-graph roadmap.

## Preserved

- Graph and bounded-loop engine.
- Monitoring of active role, provider, configured model, phase, heartbeat, cost, and quota.
- Pause, stop, force terminate, cancel, emergency stop, and recovery.
- Typed confirmations, Approval Inbox, grouping, and reusable scoped grants.
- One-writer worktree policy.
- Deterministic verification and independent review.
- MemoSprout as optional integration only.
- RoleFlock name, roleflock.com, and localhost runtime.

## Change policy

Development should now begin. New product ideas go through an RFC. Technical choices go through ADRs. Only a verified Phase 0 blocker may change the frozen MVP contract.

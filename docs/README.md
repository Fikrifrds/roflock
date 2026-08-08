# Roflock documentation index

Roflock is evolving from the RoleFlock delivery-assurance implementation into an
open-source workflow language, compiler, and governed graph runtime. Both
generations of documentation live here on purpose: the RoleFlock-era documents
record decisions the current runtime still depends on, so they are retained as
history rather than deleted.

## Read order for implementation work

1. [`../AGENTS.md`](../AGENTS.md) — master instruction and evolution guardrails
2. [`prd/ROFLOCK_OPEN_SOURCE_PRD_v1.0.md`](prd/ROFLOCK_OPEN_SOURCE_PRD_v1.0.md) — target product
3. [`implementation/ROFLOCK_EVOLUTION_IMPLEMENTATION_PLAN_v1.0.md`](implementation/ROFLOCK_EVOLUTION_IMPLEMENTATION_PLAN_v1.0.md) — phase sequence R0–R10
4. [`implementation/ROFLOCK_REPO_AUDIT.md`](implementation/ROFLOCK_REPO_AUDIT.md) — **what the checkout actually contains**
5. [`implementation/ROFLOCK_EXISTING_REPO_MAPPING_v1.0.md`](implementation/ROFLOCK_EXISTING_REPO_MAPPING_v1.0.md) — planned classification
6. [`implementation/ROFLOCK_MIGRATION_BACKLOG_v1.0.md`](implementation/ROFLOCK_MIGRATION_BACKLOG_v1.0.md) — atomic tickets
7. [`adr/`](adr/) — accepted architecture decisions
8. [`rfc/`](rfc/) — proposed contracts awaiting acceptance

The audit outranks the planning documents. Where a plan describes the repository
differently from the code, the audit records the discrepancy and the code wins.

## Authoritative

| Path                       | Contents                                                        |
| -------------------------- | --------------------------------------------------------------- |
| `prd/`                     | Roflock open-source PRD and AI build backlog                    |
| `implementation/`          | Migration plan, repo audit, mapping, backlog, foundation report |
| `rfc/`                     | RFC-001 Graph IR v1 (proposed — implementation baseline for R2) |
| `adr/ADR-001..019`         | Accepted decisions; all still binding                           |
| `security/threat-model.md` | Security invariants; survive the rebrand unchanged              |
| `test-plans/`              | Manual checklists, readiness and exit gates                     |
| `benchmarks/`              | Verified-fix benchmark baseline                                 |
| `public/`                  | User-facing copy; needs Roflock rebrand in R1                   |
| `crash-recovery.md`        | Operator recovery procedure                                     |

## Historical (retained, not current direction)

`product/roleflock_*` — RoleFlock-era PRD baseline, implementation and delivery
assurance plans, phase-0 backlog and checklist, positioning, release readiness
and GTM, and the beyond-coding thesis. These explain _why_ the current runtime
looks the way it does. Several remain the only written record of behaviour the
migration is required to preserve, so they are cited by the audit rather than
superseded by it.

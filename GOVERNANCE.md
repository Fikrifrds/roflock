# Governance

Roflock is an open-source project currently maintained by the repository owner.
Governance is intentionally lightweight for public alpha and may evolve as the
contributor base grows.

## Roles

- **Users** run Roflock and provide feedback.
- **Contributors** submit issues, documentation, tests, designs, or code under
  Apache-2.0.
- **Maintainers** triage work, review and merge changes, steward compatibility
  and security, make releases, and administer project infrastructure.

There is currently one maintainer authority: the GitHub repository owner. No
employment, paid plan, or vendor relationship grants technical decision rights.

## Decisions

Routine fixes and compatible improvements are decided through issue/pull-request
review. A change to language semantics, Graph IR, runtime guarantees, security
boundaries, persisted formats, public APIs, or governance requires an RFC or ADR
with alternatives and compatibility impact.

Decisions prioritize, in order:

1. security and truthful behavior;
2. compatibility with proven runtime/data contracts;
3. the open-source invariant;
4. evidence from tests and real integrations; and
5. simplicity for users and maintainers.

Maintainers may reject a technically working change that introduces a second
runtime, weakens deterministic checks, hides capability limits, or makes core
self-hosted functionality paid-only.

Security decisions may be developed privately during an embargo. The outcome
and non-exploitative rationale should be published with the fix.

## Releases and roadmap

Releases follow the documented [release process](docs/release/process.md).
Roadmap and completion claims must point to repository evidence; a planning
document or maintainer statement alone does not make a feature complete.
Managed-service work must remain separable from the complete open-source core.

## Changes to governance

Governance changes use a normal public pull request and require explicit
maintainer approval. As sustained contributors emerge, maintainership may be
granted based on demonstrated judgment, review quality, security care, and
reliable stewardship—not commit count alone.

If the current maintainer becomes unavailable, stewardship should transfer to
trusted active contributors with access handed over through GitHub/npm rather
than allowing an unmaintained package to be silently republished elsewhere.

## Conduct and conflicts

Participants follow the [Code of Conduct](CODE_OF_CONDUCT.md). Maintainers
should disclose material conflicts when deciding provider integrations,
commercial services, sponsorships, or security issues. Project decisions and
release notes must not conceal paid influence or favor a vendor inside Graph IR
semantics.

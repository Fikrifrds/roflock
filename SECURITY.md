# Security policy

## Report privately

Do not open a public issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/Fikrifrds/roflock/security/advisories/new).
If that channel is unavailable, contact the repository owner privately through
their GitHub profile and ask for a secure reporting channel without including
exploit details in the first public message.

Include, when available:

- affected Roflock version/commit and operating system;
- installation method and relevant non-secret configuration;
- expected and observed behavior;
- minimal reproduction or proof of concept;
- security impact and whether exploitation is ongoing; and
- whether and how you want to be credited.

Never include real provider tokens, daemon session values, private repository
content, or personal data. Use synthetic fixtures and redact logs/diagnostics.

This is currently a maintainer-operated pre-1.0 project without a guaranteed
response SLA. Reports are acknowledged and triaged as capacity allows. The
maintainer will coordinate scope, remediation, disclosure timing, CVE/advisory
publication when appropriate, and credit. Please allow a reasonable embargo for
investigation and a supported fix before public disclosure.

## Supported versions

Before 1.0, security fixes land on `main` and in the next patch/prerelease.
There are no maintained back branches unless a release advisory explicitly
says otherwise. Users should update to the newest published version.

## In scope

Examples include:

- daemon exposure beyond loopback or authentication/origin/CSRF bypass;
- session, provider, runner-signing, or other secret disclosure;
- repository/path/symlink escape or forbidden context disclosure;
- execution without the writer lease or concurrent writers in one worktree;
- reaching acceptance without required deterministic verification;
- a model granting itself authority, bypassing approval, or changing a protected
  transition without a typed outcome;
- a driver overstating permissions, session continuity, usage, or cancellation;
- evidence, audit, signature, semantic-hash, or Change Passport integrity
  bypass;
- unsafe invocation of a provider CLI or command runner; and
- the public Playground reaching a local daemon, filesystem, credential, or
  execution surface.

## Usually out of scope

- compromise by an attacker who already controls the daemon's OS account;
- prompt injection that changes only untrusted model output and triggers no
  unauthorized effect;
- a vulnerability entirely inside an upstream harness/provider, unless Roflock
  invokes or represents it unsafely;
- findings that require disabling a documented safeguard; and
- denial of service from intentionally enormous local inputs with no security
  boundary crossed.

Reports may move into scope when they demonstrate a concrete protected effect.
See the [threat model](docs/security/threat-model.md) and
[Playground boundary](docs/security/playground-local-runtime.md).

## Disclosure and fixes

Security changes receive the same open-source implementation as every other
install. The project does not maintain paid-only validators, stronger hosted
permission enforcement, or more complete audit behavior. A coordinated release
should include tests, an advisory, affected/fixed versions, mitigations, and
upgrade instructions without exposing reporters before consent.

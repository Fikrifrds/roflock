# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities privately. Do **not** open a public issue for
anything that could be exploited before a fix is available.

Use GitHub's private vulnerability reporting on
[github.com/Fikrifrds/roflock](https://github.com/Fikrifrds/roflock/security/advisories/new).

Please include what you were running, what you observed, and the smallest
reproduction you have. A proof of concept helps, but a clear description is
enough to start.

We will acknowledge a report and tell you whether we consider it in scope. If a
fix is needed we will keep you updated while it is prepared, and credit you in
the advisory unless you prefer otherwise.

## Supported versions

Roflock is pre-1.0. Security fixes land on `main` and in the next release; there
are no maintained back-branches yet.

## Scope

Roflock runs on a developer's machine, drives coding agents that can modify a
repository, and decides what is allowed to ship. The security properties that
matter most are the ones that keep a model from quietly widening its own
authority.

In scope — a defect in any of these is a vulnerability:

- the daemon binding beyond loopback, or an API route reachable without the
  session token;
- session token or CSRF bypass, or the token becoming readable by another local
  OS account;
- escaping the repository path and symlink deny list, or reaching credential
  files excluded from context;
- writing to a worktree without holding its lease, or two writers running at
  once;
- reaching an accepted state without a required deterministic check passing;
- a model or a prompt granting itself permissions, approving its own protected
  effect, or bypassing a human approval gate;
- a driver claiming a capability it does not have — in particular reporting work
  as cancelled when the remote side may still be running;
- secrets appearing in logs, events, evidence, diagnostics, or exports;
- repository contents leaving the machine other than to the provider the
  operator configured.

Out of scope:

- an attacker who already has the daemon's OS account — that account is the
  trust boundary, not something Roflock defends against;
- prompt injection that only affects the _content_ of a model's output. Prompt
  text is not a security boundary in Roflock by design. Injection that causes a
  protected effect without the corresponding approval or lease **is** in scope;
- vulnerabilities in a coding harness or provider CLI, which are their own trust
  boundary — though tell us if Roflock invokes one unsafely;
- findings that require the operator to disable a documented safeguard.

See [`docs/security/threat-model.md`](docs/security/threat-model.md) for the
boundaries and their current mitigations.

## Security is not a paid tier

Roflock does not gate security behind a licence. There is no build where the
validator is stronger, permissions are enforced more strictly, or audit is more
complete because someone paid. A self-hosted install gets the same guarantees as
any other.

# Support

Roflock public alpha is community-supported and carries no response-time or
uptime SLA.

## Where to ask

- Reproducible bug or documentation error: open a
  [GitHub issue](https://github.com/Fikrifrds/roflock/issues).
- Feature proposal: open an issue describing the user problem, expected
  contract, alternatives, and compatibility impact.
- Security vulnerability: follow [SECURITY.md](SECURITY.md) privately.
- Harness/provider account, billing, or upstream CLI behavior: use that
  provider's support channel unless Roflock invokes or reports it incorrectly.

Before filing a runtime issue, run:

```bash
roflock --version
roflock doctor --json
roflock drivers doctor --json
roflock daemon status --json
```

For a source checkout also include the commit and the smallest targeted test
that fails. Studio's **Privacy & local data → Export diagnostics** produces a
redacted bundle, but inspect it before attaching. Never attach `session.json`,
provider credential files, secret-store files, `.env`, private keys, or raw
private repository contents.

## Useful issue details

- operating system, architecture, Node version, install method, and Roflock
  version/commit;
- exact command and sanitized workflow source;
- expected result, actual result, exit code, and error code;
- whether simulation mode was enabled;
- driver ID/version and non-secret readiness fields; and
- minimal repository fixture or reproduction steps.

## Recovery before reporting

Do not delete state first. Follow the [operator guide](docs/runtime/operator-guide.md)
for daemon ownership, backup, integrity check, and recovery. If a paid turn has
an unknown outcome after a crash/cancel, do not retry it blindly; preserve the
events and report the ambiguity.

Public alpha supports the latest release only. Historical RoleFlock data and
environment fallbacks remain compatibility surfaces, but old application
versions do not receive separate maintenance unless a security advisory says
otherwise.

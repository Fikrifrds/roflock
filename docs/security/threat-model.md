# RoleFlock local-first threat model

**Scope:** Phase 0 daemon + web UI on a single developer machine.  
**Assumption:** The operator trusts their OS user account; untrusted code may exist in registered repositories and provider prompts.

## Trust boundaries

| Boundary | What crosses it | Mitigation |
|----------|-----------------|------------|
| Browser ↔ daemon | HTTP on loopback | Bind `127.0.0.1`, session token, CSRF on mutations, origin allow-list |
| Daemon ↔ repository | Git worktrees, leased writes | Path/symlink deny list, one writer lease per worktree |
| Daemon ↔ provider CLIs | stdin/stdout, CLI flags | No shell endpoint; spawn with arg arrays; CLIs are an explicit trust boundary |
| Daemon ↔ network | Optional update check | Product name + version + platform only — never repository paths or contents |

## Loopback bind

The daemon listens on `127.0.0.1` by default. Remote hosts cannot reach the API without an explicit port-forward or proxy misconfiguration. The UI is expected to talk to the same machine.

## CSRF and origin

Mutating requests require a session token and CSRF header. Requests with a non-local `Origin` are rejected. Read-only GETs require the token only.

## Path and symlink deny

Repository operations reject `.env`, key material, credential patterns, and symlink escapes outside the registered root. Context compilation applies the same exclusions before any provider sees file paths or content.

## Writer lease

Only one active writer may hold a lease on a task worktree at a time. Prevents concurrent agent writes from colliding or leaving partial state.

## Secret redaction

Exports, diagnostics bundles, and logs redact API keys, tokens, and private key patterns. Secret-sensitivity context items are omitted from compiled prompts.

## No shell endpoint

There is no HTTP route that executes arbitrary shell strings. Deterministic checks use `@roleflock/command-runner`, which spawns a fixed binary with an argument array (no shell interpolation).

## Provider CLIs as trust boundary

Claude, Codex, Cursor, and custom HTTP providers run outside the daemon sandbox. RoleFlock governs *when* they are invoked, *what context* is disclosed, and *where* writes may land — but vendor CLIs retain their own permissions on the host. Operators should treat installed provider binaries like any other privileged local tool.

## Out of scope (Phase 0)

- Multi-user or hosted deployment hardening
- Supply-chain signing of provider binaries
- Network egress filtering beyond update-check payload limits

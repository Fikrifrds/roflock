# RoleFlock local-first threat model

**Scope:** Phase 0 daemon + web UI on a single developer machine.  
**Assumption:** The operator trusts their OS user account; untrusted code may exist in registered repositories and provider prompts.

## Trust boundaries

| Boundary                      | What crosses it              | Mitigation                                                                                                               |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Browser ↔ daemon              | HTTP on loopback             | Bind `127.0.0.1`, session token delivered through a 0600 file, CSRF on mutations, origin allow-list on every API request |
| Other local OS users ↔ daemon | Loopback is shared host-wide | Token is never served by the API; it is readable only from `~/.roleflock/session.json` (mode 0600)                       |
| Daemon ↔ repository           | Git worktrees, leased writes | Path/symlink deny list, one writer lease per worktree                                                                    |
| Daemon ↔ provider CLIs        | stdin/stdout, CLI flags      | No shell endpoint; spawn with arg arrays; CLIs are an explicit trust boundary                                            |
| Daemon ↔ network              | Optional update check        | Product name + version + platform only — never repository paths or contents                                              |

## Loopback bind

The daemon listens on `127.0.0.1` by default. Remote hosts cannot reach the API without an explicit port-forward or proxy misconfiguration. The UI is expected to talk to the same machine.

**Loopback is not an authorisation boundary.** Every OS account on the host can open `127.0.0.1:4178`. Because a RoleFlock session can run verification commands as the daemon's user, an unauthenticated local API would be a privilege escalation for any other local user. The session token — not the bind address — is what stops that.

## Session token delivery

The token lives in `<dataDir>/session.json` with mode `0600`, so only the OS user who owns the daemon can read it. It is delivered to the browser exactly once, through the launch URL the daemon prints on startup (`http://127.0.0.1:4178/?rft=…`); the UI stores it and scrubs the parameter from the address bar via `history.replaceState`.

No API route returns the token. `/api/runtime/info` requires the token and returns only the CSRF value plus an httpOnly cookie. The token is also never accepted from a query string, so it cannot leak through proxy or access logs; the SSE stream authenticates with that cookie instead.

`ROLEFLOCK_ROTATE_TOKEN=1` mints a fresh token and invalidates the previous launch URL. `pnpm url` reprints the current one.

## CSRF and origin

Every `/api/*` request except `/api/health` requires the session token and is rejected if it carries a non-local `Origin`. Mutations additionally require the CSRF header. Token and CSRF comparisons use constant-time equality.

## Path and symlink deny

Repository operations reject `.env`, key material, credential patterns, and symlink escapes outside the registered root. Context compilation applies the same exclusions before any provider sees file paths or content.

## Writer lease

Only one active writer may hold a lease on a task worktree at a time. Prevents concurrent agent writes from colliding or leaving partial state.

## Secret redaction

Exports, diagnostics bundles, and logs redact API keys, tokens, and private key patterns. Secret-sensitivity context items are omitted from compiled prompts.

## No shell endpoint

There is no HTTP route that executes arbitrary shell strings. Deterministic checks use `@roleflock/command-runner`, which spawns a fixed binary with an argument array (no shell interpolation).

## Provider CLIs as trust boundary

Claude, Codex, Cursor, and custom HTTP providers run outside the daemon sandbox. RoleFlock governs _when_ they are invoked, _what context_ is disclosed, and _where_ writes may land — but vendor CLIs retain their own permissions on the host. Operators should treat installed provider binaries like any other privileged local tool.

## Out of scope (Phase 0)

- Multi-user or hosted deployment hardening
- Supply-chain signing of provider binaries
- Network egress filtering beyond update-check payload limits

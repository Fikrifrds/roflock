# Public Playground and local runtime boundary

**Status:** public-alpha security decision

The public Roflock Playground is a static, browser-only compiler surface. It
must not connect to the local daemon, read a repository, execute a shell,
control an agent process, or receive local credentials.

```text
public Playground origin
  source in browser memory / URL fragment
       ↓
  compiler → Graph IR → validator → diagram

  ═════════ no runtime bridge ═════════

local daemon origin
  authenticated Studio / CLI / MCP
       ↓
  immutable run → runGraph → AgentDriver
```

## Shipped public-alpha behavior

- The Playground bundle contains compiler, validator, and graph-layout code.
- It has no API client and makes no daemon/network request while compiling.
- Share links place source in the URL fragment, which is not sent in HTTP
  requests; no server-side share storage exists.
- It has no “run for real” button, local discovery probe, custom-protocol link,
  localhost fetch, WebSocket, MCP transport, filesystem picker, or credential UI.
- Studio links to the Playground only through an explicitly configured absolute
  public URL. Production rejects relative URLs, executable schemes, plain HTTP,
  and loopback hosts; a missing/unsafe value hides the link.
- The Playground is deployed separately and must not be served from the daemon
  origin or inherit Studio local storage/cookies.

These properties are enforced by browser tests for zero fetches during normal
interaction and fail-closed production URL resolution.

## Assets and attackers

Protected assets are the daemon session/CSRF values, repositories and
worktrees, provider credentials, driver processes, approval authority, and
recorded evidence. Relevant attackers include a compromised public origin,
malicious shared workflow source, another local OS user, DNS/content injection,
and an agent attempting to approve its own run.

Loopback is not authentication. Browsers can send requests to localhost, and
other users on one host can open the same port. The daemon therefore requires
its mode-`0600` session secret, local-origin policy, and CSRF token independent
of bind address.

## Source is untrusted

Workflow text from a share link is data. Compilation must not evaluate imports,
execute commands, resolve local paths, or render unescaped labels. Diagnostics
and diagrams are derived from the same compiler/Graph IR contract as the CLI,
but successful compilation grants no runtime authority.

The fragment may expose source to browser extensions, screenshots, copied URLs,
history sync, or anyone receiving the link. Users should not place secrets in a
workflow, even though Roflock does not upload it.

## Future “run locally” protocol

No browser-to-local handoff ships in public alpha. A future implementation
requires a separate accepted RFC and all controls below:

1. The user installs/starts local Roflock first; the public page never installs
   software or discovers credentials.
2. Playground exports source as a download/copy or sends a one-time opaque
   handoff request containing no daemon token.
3. Studio opens independently and shows exact source hash, repository, workflow,
   requested effects, profile, and brief before an explicit user-presence click.
4. The daemon mints a short-lived, single-use, purpose-bound nonce after local
   confirmation. The public origin cannot mint, refresh, or redeem it alone.
5. Origin is allowlisted exactly; state change requires authenticated session,
   CSRF, nonce, expiry, and replay rejection. CORS wildcard and token-bearing
   URLs are forbidden.
6. Import creates an inert draft. Starting a run is a second explicit local
   action and still goes through compilation, immutable snapshotting, policy,
   approvals, and the existing runtime.
7. No approval/grant decision is transferable in the handoff. Agents and the
   public site cannot approve protected work.
8. Every offer, confirmation, expiry, rejection, import, and start is audited
   without logging source secrets or session material.

A custom URL scheme alone is insufficient: it is spoofable, can be invoked
without user understanding, and provides no origin, replay, or payload-integrity
proof. A localhost POST alone is also insufficient because CORS is not
authentication and simple browser requests can still create side effects.

## Deployment requirements

- Serve the public bundle over HTTPS with a restrictive Content Security Policy
  that omits `connect-src` or sets it to `'none'` while no network feature exists.
- Do not embed Studio/daemon pages in Playground frames or vice versa; use
  `frame-ancestors 'none'` for local control surfaces.
- Keep source maps and asset provenance appropriate for an Apache-2.0 static
  release, but never inject environment secrets at build time.
- Treat analytics as a later privacy decision. Public alpha has no requirement
  to collect workflow source, and analytics code must never receive it.
- Deploying `/play/` and publishing a domain are operator actions, distinct from
  repository readiness.

## Security regression gates

Release checks must preserve:

- Playground production build and browser/compiler tests;
- zero network calls during compile/example/share interactions;
- no local-daemon dependency in the Playground package;
- safe fragment round trips and corrupt-fragment rejection;
- Studio production link rejection for HTTP, loopback, relative, and executable
  targets; and
- daemon authentication, origin, CSRF, token-redaction, and control-surface
  tests.

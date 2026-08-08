# Playground and Studio guide

Roflock ships two browser surfaces with deliberately different authority. The
Playground is a public, static language tool. Studio is the private control
surface of one local daemon. They share the compiler and graph renderer, but
they must not share an origin, session, or deployment model.

| Surface    | Purpose                                                            | May execute work?                | Data and authentication                                                   | Deployment                                     |
| ---------- | ------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| Playground | Edit `.roflock`, compile, validate, and inspect Graph IR visually  | No                               | Source stays in browser memory or the URL fragment; no daemon credential  | Public static HTTPS site                       |
| Studio     | Create tasks, operate runs, decide approvals, and inspect evidence | Yes, through the governed daemon | Private daemon token, CSRF value, local repositories, and runtime records | Bundled with and served by the loopback daemon |

## Playground

### Use it

Open the deployed Playground or run it locally. Choose **Linear delivery**,
**Bug fix**, or **Parallel review** as a starting point, then edit the workflow
source. Compilation happens as you type.

The result pane shows:

- compiler and Graph IR diagnostics with source lines;
- the canonical graph rendered by the same `@roleflock/graph-ui` package used
  by Studio and `roflock render`;
- node, edge, and bounded-loop counts; and
- successful, typed-failure, and writer-node visual distinctions.

The Playground never draws a partial graph after an error. Fix all error
diagnostics before treating the displayed graph as executable. Warnings do not
prevent compilation, but should still be reviewed.

**Copy share link** serializes the source into the URL fragment. A fragment is
not sent in the HTTP request and Roflock has no share-storage service. It can
still be exposed through copied URLs, browser extensions, screenshots, history
sync, or another person who receives it. Never put credentials or repository
secrets in workflow source.

The full language contract is in the [language reference](../language/reference.md).

### Run locally from source

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm dev:playground
```

Open `http://127.0.0.1:5174/`. This process is independent of the daemon and
Studio.

Run its checks with:

```bash
pnpm --filter @roleflock/playground typecheck
pnpm --filter @roleflock/playground test
```

### Build and deploy the public site

The public build is rooted at `/play/`:

```bash
pnpm build:playground:public
```

Deploy the contents of `apps/playground/dist/` to an HTTPS static host at that
path. If the public URL is `https://example.org/play/`, `/play/assets/...` must
resolve from the same deployment. There is no server API, database, SSR
process, daemon discovery, or provider configuration to deploy.

Use a restrictive policy appropriate to a self-contained static app. At
minimum:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

Cache fingerprinted assets for a long lifetime. Revalidate `index.html` so a
new release can point at its new asset names. Do not inject secrets, provider
keys, a daemon URL, analytics that receives workflow text, or permissive
`connect-src` rules into the bundle.

Do not host the Playground on the daemon/Studio origin. A public script on that
origin would cross the local session boundary even if it currently made no API
request.

### What it cannot do

The Playground cannot start a run, access a repository, execute a command,
invoke an agent, inspect evidence, or approve work. Public alpha has no
browser-to-local-runtime handoff. Copy the workflow into a local file and use
the CLI or Studio. Any future one-click handoff requires a separate accepted
security RFC; the required controls are recorded in the
[Playground/local-runtime decision](../security/playground-local-runtime.md).

## Studio

### Launch the installed product

After installing Roflock, run:

```bash
roflock studio
```

The command starts the local daemon when needed, reuses it when already healthy,
and prints a private URL such as:

```text
Open Roflock Studio: http://127.0.0.1:4178/?rft=...
```

Open that URL in a browser on the same machine. Keep it private: the bootstrap
token grants control of the local daemon. For machine-readable launch metadata:

```bash
roflock studio --json
```

It returns `url`, `baseUrl`, `dataDir`, and daemon `ownership`. The complete
lifecycle and data procedures are in the
[operator guide](../runtime/operator-guide.md).

### Develop Studio from source

Use two terminals from the repository root. The daemon port must match in both
processes if it is customized.

```bash
# terminal 1
pnpm dev

# terminal 2
pnpm dev:web
```

Studio's development server listens on `http://127.0.0.1:5173/` and proxies
`/api` to the daemon, which defaults to `http://127.0.0.1:4178`. Obtain the
authenticated daemon URL with `pnpm url` or `roflock studio`, then use its
`rft` value on the development origin when prompted. `ROFLOCK_PORT` is the
preferred port variable; `ROLEFLOCK_PORT` remains a compatibility fallback.

The development shell links to `http://127.0.0.1:5174/` by default. Start
`pnpm dev:playground` separately if that destination is needed.

### Main workflow

1. **Providers** — confirm a supported harness is installed and authenticated,
   or register an explicit compatible provider command.
2. **Roles** — inspect or change the provider/model routing for each coding role.
3. **Projects** — register the repository Roflock is allowed to operate on.
4. **New task** — select a project and workflow, provide the brief, and create
   the governed task.
5. **Task workspace** — inspect the immutable workflow diagram, execution plan,
   contract, workspace changes, verification state, and stop guarantees.
6. **Approvals** — approve or reject the exact pending request. Agents cannot
   approve their own work.
7. **Evidence** — inspect the event/evidence chain, usage, exports, and change
   passport before accepting the outcome.

The sidebar also provides the local knowledge library and privacy/settings
operations. Deleting local runtime data is intentionally distinct from deleting
backups; read the confirmation and operator guide before proceeding.

### Session and live-state behavior

The launch token is consumed from `?rft=...`, saved locally for that browser,
and immediately scrubbed from the address bar. Studio exchanges it for the CSRF
value used on state-changing requests and an HTTP-only cookie used by the event
stream. The token is never placed in the SSE URL.

The connection label is operational state, not decoration:

- **Connected** means the event stream is live;
- **Reconnecting / stale** means shown data may have changed while disconnected;
- **Disconnected / stale** means live updates stopped and require attention;
- an unauthorized screen means this browser lacks a valid daemon session; and
- a daemon-unreachable screen means the local process cannot be contacted.

On reconnection Studio refetches state because events missed while disconnected
are not replayed by the browser stream.

When `ROFLOCK_FORCE_FAKE=1` (legacy fallback `ROLEFLOCK_FORCE_FAKE=1`) Studio
shows **Simulation mode**. Scripted providers, changes, and checks are not
production verification and must not be represented as launch evidence.

### Production deployment boundary

Studio is built into the npm artifact and served from the daemon's installed
package directory. It is not a public SPA to upload to a CDN, and it must not be
exposed through a public reverse proxy. The daemon binds to loopback by default,
but loopback is only network scope; token, origin, CSRF, policy, and approval
controls remain mandatory.

To show a Playground shortcut in a production Studio build, set a public,
absolute, non-loopback HTTPS URL at build time:

```bash
VITE_PLAYGROUND_URL=https://example.org/play/ pnpm build
```

Invalid, relative, plain-HTTP, and loopback production values fail closed and
hide the link. Development accepts HTTP to support loopback testing. This link
does not transfer workflow source, local credentials, or a runtime request.

### Troubleshooting

- **Studio says unauthorized:** run `roflock studio` again and open the newly
  printed private URL. Do not manually copy an old CSRF value.
- **Daemon is unreachable:** run `roflock daemon status --json`, then
  `roflock doctor --json`. Start with `roflock daemon start` if ownership and
  configuration are valid.
- **State looks stale:** wait for **Connected**. If it remains disconnected,
  resolve the daemon/session problem before making an approval decision.
- **Playground link is absent:** configure a valid HTTPS
  `VITE_PLAYGROUND_URL` before the Studio build; absence is the safe default.
- **Playground assets return 404:** deploy the public build at `/play/`, or use
  the package's normal build when hosting at `/`.
- **A real provider is unavailable:** authenticate with that harness directly,
  then use `roflock drivers --json` and `roflock doctor --json` to distinguish
  installed, authenticated, usable, and cancellation capability.

## Release checks for both surfaces

Before release, preserve all of these properties:

```bash
pnpm --filter @roleflock/playground typecheck
pnpm --filter @roleflock/playground test
pnpm build:playground:public
pnpm --filter @roleflock/web typecheck
pnpm --filter @roleflock/web test
pnpm --dir apps/cli test:package
```

The package smoke test installs the packed artifact into a clean temporary
project, starts its daemon, fetches the bundled Studio HTML, checks that Studio
has no remote font dependency, and stops only the daemon it proved it owns.

# Contributing

Use pnpm and Node 24+. Keep the daemon loopback-only, preserve append-only events, and do not introduce generic shell or filesystem APIs.

Before opening a change, run `pnpm typecheck`, `pnpm test`, and `pnpm build`. Keep provider actions permission-scoped and ensure mutations are represented by durable events or control commands.

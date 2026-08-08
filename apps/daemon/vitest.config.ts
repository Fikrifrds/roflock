import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    // Most daemon files create Git repositories, SQLite databases, provider
    // probes, or loopback servers. Letting a many-core workstation start all
    // of them together starves the durable-run polling tests and makes a
    // healthy runtime look hung. Four workers remains parallel without
    // oversubscribing those external resources.
    maxWorkers: 4,
    // Provider discovery shells out to the real CLIs (`claude --help`,
    // `cursor-agent --help`, …). On a machine where those are installed a cold
    // probe legitimately exceeds vitest's 5s default.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

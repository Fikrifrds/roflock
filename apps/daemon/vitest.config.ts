import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    // Provider discovery shells out to the real CLIs (`claude --help`,
    // `cursor-agent --help`, …). On a machine where those are installed a cold
    // probe legitimately exceeds vitest's 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

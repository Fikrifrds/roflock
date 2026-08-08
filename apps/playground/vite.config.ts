import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The public Playground is a static bundle by design.
 *
 * It compiles `.roflock` in the browser and talks to nothing: no daemon, no
 * shell, no filesystem, no credentials. The PRD is explicit that a public origin
 * must never reach local execution, and the simplest way to guarantee that is an
 * app with no server to reach.
 */
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
});

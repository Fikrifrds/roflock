import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const internal = (path: string) =>
  fileURLToPath(new URL(`../../packages/${path}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@roleflock/change-passport': internal('change-passport'),
      '@roleflock/database': internal('database'),
      '@roleflock/evidence': internal('evidence'),
      '@roleflock/graph-ir': internal('graph-ir'),
      '@roleflock/graph-ui': internal('graph-ui'),
      '@roleflock/language': internal('language'),
    },
  },
});

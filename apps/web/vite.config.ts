import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const daemonPort = Number(process.env.ROLEFLOCK_PORT ?? 4178);
if (!Number.isInteger(daemonPort) || daemonPort < 1 || daemonPort > 65_535) {
  throw new Error('ROLEFLOCK_PORT must be an integer from 1 to 65535.');
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${daemonPort}`,
        // Native folder dialogs can stay open for minutes.
        timeout: 300_000,
        proxyTimeout: 300_000,
      },
    },
  },
});

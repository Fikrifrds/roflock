import { launchUrl, sessionFilePath } from './auth.js';
import { readEnv } from '@roleflock/contracts';
import { createServer } from './server.js';

const { app, session, host, port, dataDir } = await createServer();
try {
  await app.listen({ host, port });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    process.stderr.write(
      `RoleFlock could not start: ${host}:${port} is already in use.\n` +
        `Choose another port, for example: ROLEFLOCK_PORT=${port + 1} pnpm start\n`,
    );
  }
  throw error;
}

const url = launchUrl(host, port, session);
app.log.info({ host, port, sessionFile: sessionFilePath(dataDir) }, 'RoleFlock daemon listening');

// Written to stdout, not the structured log: this URL carries the session token
// and is the one-time handoff to the browser. Anything that can read this stream
// already runs as the user who owns the daemon.
if (readEnv('QUIET_LAUNCH') !== '1') {
  process.stdout.write(
    [
      '',
      '  RoleFlock is running.',
      '',
      `  Open the UI:    ${url}`,
      `  Vite dev UI:    ${url.replace(`:${port}`, ':5173')}`,
      `  Session file:   ${sessionFilePath(dataDir)} (mode 0600)`,
      '',
      '  Keep this URL private — it grants full control of the daemon.',
      '  `pnpm url` prints it again. `ROLEFLOCK_ROTATE_TOKEN=1` rotates the token.',
      '',
      '',
    ].join('\n'),
  );
}

let closing = false;
const close = (signal: string) => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Roflock daemon shutting down');
  void app
    .close()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `Roflock daemon shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
};
process.once('SIGTERM', () => close('SIGTERM'));
process.once('SIGINT', () => close('SIGINT'));

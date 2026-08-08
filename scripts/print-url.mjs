#!/usr/bin/env node
// Prints the RoleFlock launch URL from the local session file.
// The token lives in <data dir>/session.json (mode 0600) so that only this OS
// user can obtain it — loopback alone is shared with every other local account.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Standalone script: no workspace import, so this mirrors resolveDataDir() in
// apps/daemon/src/data-dir.ts. Keep the two in step — if this picked the new
// directory while the daemon was still running from the legacy one, the script
// would report on a database nobody is using.
function resolveDataDir() {
  const explicit = process.env.ROFLOCK_DATA_DIR ?? process.env.ROLEFLOCK_DATA_DIR;
  if (explicit !== undefined && explicit !== '') return explicit;
  const current = join(homedir(), '.roflock');
  if (existsSync(current)) return current;
  const legacy = join(homedir(), '.roleflock');
  return existsSync(legacy) ? legacy : current;
}

const dataDir = resolveDataDir();
const sessionFile = join(dataDir, 'session.json');
const port = Number(process.env.ROFLOCK_PORT ?? process.env.ROLEFLOCK_PORT ?? 4178);

let session;
try {
  session = JSON.parse(readFileSync(sessionFile, 'utf8'));
} catch {
  console.error(`No session file at ${sessionFile}. Start the daemon first: pnpm dev`);
  process.exit(1);
}

if (typeof session.token !== 'string' || !session.token) {
  console.error(`Session file ${sessionFile} has no token. Restart the daemon.`);
  process.exit(1);
}

const query = `?rft=${encodeURIComponent(session.token)}`;
console.log(`Built UI:    http://127.0.0.1:${port}/${query}`);
console.log(`Vite dev UI: http://127.0.0.1:5173/${query}`);

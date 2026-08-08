#!/usr/bin/env node
/**
 * Local support diagnostics helper.
 * Prints a redacted checklist; does not upload repository contents.
 */
import { existsSync, readdirSync } from 'node:fs';
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
const dbPath = join(dataDir, 'roleflock.db');

const report = {
  product: 'RoleFlock',
  version: '0.1.0',
  generatedAt: new Date().toISOString(),
  dataDirPresent: existsSync(dataDir),
  databasePresent: existsSync(dbPath),
  documentDirPresent: existsSync(join(dataDir, 'documents')),
  worktreeDirPresent: existsSync(join(dataDir, 'worktrees')),
  backupCount: existsSync(join(dataDir, 'backups'))
    ? readdirSync(join(dataDir, 'backups')).length
    : 0,
  notes: [
    'Run the daemon and GET /api/diagnostics/export for a redacted JSON bundle.',
    'This CLI never reads repository source trees or API keys.',
    'See docs/crash-recovery.md for restart and orphan process recovery.',
  ],
};

console.log(JSON.stringify(report, null, 2));

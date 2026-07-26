#!/usr/bin/env node
/**
 * Local support diagnostics helper.
 * Prints a redacted checklist; does not upload repository contents.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dataDir = process.env.ROLEFLOCK_DATA_DIR ?? join(homedir(), '.roleflock');
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

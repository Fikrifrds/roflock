import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readEnv } from '@roleflock/contracts';

export const CURRENT_DATA_DIR_NAME = '.roflock';
export const LEGACY_DATA_DIR_NAME = '.roleflock';

/**
 * The SQLite database filename inside the data directory.
 *
 * Deliberately still the legacy spelling. Renaming the directory is safe
 * because resolution can look in two places; renaming the database means
 * moving a live file plus its `-wal` and `-shm` siblings, which is a real
 * migration and a separate decision. It is a constant so the name exists in
 * exactly one place — it used to be typed out separately in the existence
 * probe, the backup copy loop, and the export manifest, and a rename that
 * missed one would have produced backups silently missing the database.
 */
export const DATABASE_FILE_NAME = 'roleflock.db';

/** The database and its SQLite sidecars, in backup order. */
export const DATABASE_FILE_NAMES = [
  DATABASE_FILE_NAME,
  `${DATABASE_FILE_NAME}-wal`,
  `${DATABASE_FILE_NAME}-shm`,
] as const;

export interface DataDirOptions {
  /** Explicit override, e.g. from a command-line flag. Wins over everything. */
  override?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  exists?: (path: string) => boolean;
  warn?: (message: string) => void;
}

/**
 * Decides which directory holds this installation's data.
 *
 * Resolution order:
 *
 *   1. an explicit override or `ROFLOCK_DATA_DIR` / `ROLEFLOCK_DATA_DIR`;
 *   2. `~/.roflock` when it already exists;
 *   3. `~/.roleflock` when it exists and the new one does not;
 *   4. `~/.roflock`, created fresh.
 *
 * Nothing is moved. An upgrade that relocated a live SQLite database, its
 * write-ahead log and its shared-memory file — potentially with a daemon still
 * holding them open — could destroy the installation it was trying to rename,
 * and the rebrand is not worth that risk. An existing user keeps running from
 * the directory they already have and is told, once, how to move it themselves
 * if they want to. Only a genuinely new install gets the new name.
 */
export function resolveDataDir(options: DataDirOptions = {}): string {
  const explicit = options.override ?? readEnv('DATA_DIR', { env: options.env });
  if (explicit !== undefined && explicit !== '') return explicit;

  const home = options.home ?? homedir();
  const exists = options.exists ?? existsSync;
  const current = join(home, CURRENT_DATA_DIR_NAME);
  if (exists(current)) return current;

  const legacy = join(home, LEGACY_DATA_DIR_NAME);
  if (exists(legacy)) {
    const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`));
    warn(
      `note: using the existing data directory ${legacy}. Roflock now prefers ${current}. ` +
        `To move it, stop Roflock and run: mv ${legacy} ${current}`,
    );
    return legacy;
  }

  return current;
}

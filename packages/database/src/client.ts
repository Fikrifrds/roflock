import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATION_001 } from './migrations/001_initial.js';

export type SqliteDb = Database.Database;

export interface OpenDatabaseOptions {
  path: string;
  readonly?: boolean;
}

export function openDatabase(options: OpenDatabaseOptions): SqliteDb {
  mkdirSync(dirname(options.path), { recursive: true });
  const db = new Database(options.path, {
    readonly: options.readonly ?? false,
    fileMustExist: false,
  });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function migrate(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: number }).version),
  );

  const migrations = [MIGRATION_001];
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const tx = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, new Date().toISOString());
    });
    tx();
  }
}

export function openMigratedDatabase(path: string): SqliteDb {
  const db = openDatabase({ path });
  migrate(db);
  return db;
}

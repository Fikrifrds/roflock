import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_DATA_DIR_NAME,
  DATABASE_FILE_NAMES,
  LEGACY_DATA_DIR_NAME,
  resolveDataDir,
} from '../src/data-dir.js';

const HOME = '/home/dev';
const current = join(HOME, CURRENT_DATA_DIR_NAME);
const legacy = join(HOME, LEGACY_DATA_DIR_NAME);

function resolve(present: string[], extra: Parameters<typeof resolveDataDir>[0] = {}) {
  const warnings: string[] = [];
  const directory = resolveDataDir({
    home: HOME,
    env: {},
    exists: (path) => present.includes(path),
    warn: (message) => warnings.push(message),
    ...extra,
  });
  return { directory, warnings };
}

describe('data directory resolution across the rename', () => {
  it('uses the new directory for a fresh install', () => {
    const result = resolve([]);

    expect(result.directory).toBe(current);
    expect(result.warnings).toEqual([]);
  });

  it('keeps an existing legacy installation running from where it already is', () => {
    const result = resolve([legacy]);

    // Nothing is moved. Relocating a live SQLite database and its sidecars
    // during an upgrade could destroy the installation the rename was meant to
    // preserve.
    expect(result.directory).toBe(legacy);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(legacy);
    expect(result.warnings[0]).toContain(`mv ${legacy} ${current}`);
  });

  it('prefers the new directory once it exists', () => {
    const result = resolve([current, legacy]);

    expect(result.directory).toBe(current);
    expect(result.warnings).toEqual([]);
  });

  it('lets an explicit override win over both', () => {
    const result = resolve([current, legacy], { override: '/tmp/elsewhere' });

    expect(result.directory).toBe('/tmp/elsewhere');
    expect(result.warnings).toEqual([]);
  });

  it.each([
    ['ROFLOCK_DATA_DIR', { ROFLOCK_DATA_DIR: '/tmp/from-env' }],
    ['ROLEFLOCK_DATA_DIR', { ROLEFLOCK_DATA_DIR: '/tmp/from-env' }],
  ])('honours %s ahead of directory probing', (_name, env) => {
    const result = resolve([current, legacy], { env, warn: () => {} });

    expect(result.directory).toBe('/tmp/from-env');
  });

  it('ignores an empty override and falls through to probing', () => {
    const result = resolve([legacy], { override: '' });

    expect(result.directory).toBe(legacy);
  });

  it('names the database and both SQLite sidecars exactly once', () => {
    // These used to be typed out separately in the existence probe, the backup
    // copy loop, and the delete list. A rename that missed one would have
    // produced a backup silently missing the database.
    expect(DATABASE_FILE_NAMES).toEqual(['roleflock.db', 'roleflock.db-wal', 'roleflock.db-shm']);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { exportedEnvNames, readEnv, resetEnvDeprecationNotices, withLegacyAlias } from './env.js';

describe('environment compatibility across the rename', () => {
  beforeEach(() => {
    resetEnvDeprecationNotices();
  });

  it('prefers the current name', () => {
    const warnings: string[] = [];
    const value = readEnv('DATA_DIR', {
      env: { ROFLOCK_DATA_DIR: '/new', ROLEFLOCK_DATA_DIR: '/old' },
      warn: (message) => warnings.push(message),
    });

    expect(value).toBe('/new');
    expect(warnings).toEqual([]);
  });

  it('falls back to the legacy name and says so once', () => {
    const warnings: string[] = [];
    const env = { ROLEFLOCK_DATA_DIR: '/old' };

    expect(readEnv('DATA_DIR', { env, warn: (m) => warnings.push(m) })).toBe('/old');
    expect(readEnv('DATA_DIR', { env, warn: (m) => warnings.push(m) })).toBe('/old');

    // An existing installation must keep working, but only complain once —
    // a warning on every read would be noise the operator learns to ignore.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ROLEFLOCK_DATA_DIR is deprecated');
    expect(warnings[0]).toContain('ROFLOCK_DATA_DIR');
  });

  it('does not fall back when the current name is set but empty', () => {
    const warnings: string[] = [];
    const value = readEnv('FORCE_FAKE', {
      env: { ROFLOCK_FORCE_FAKE: '', ROLEFLOCK_FORCE_FAKE: '1' },
      warn: (message) => warnings.push(message),
    });

    // Explicitly emptying the new name means "off". Falling through to a stale
    // legacy value would silently do the opposite of what was asked.
    expect(value).toBe('');
    expect(warnings).toEqual([]);
  });

  it('returns undefined when neither name is set', () => {
    expect(readEnv('DATA_DIR', { env: {}, warn: () => {} })).toBeUndefined();
  });

  it('warns per variable rather than once globally', () => {
    const warnings: string[] = [];
    const env = { ROLEFLOCK_DATA_DIR: '/old', ROLEFLOCK_PORT: '4178' };

    readEnv('DATA_DIR', { env, warn: (m) => warnings.push(m) });
    readEnv('PORT', { env, warn: (m) => warnings.push(m) });

    expect(warnings).toHaveLength(2);
  });

  it('exports both spellings to child processes', () => {
    expect(exportedEnvNames('TASK_ID')).toEqual(['ROFLOCK_TASK_ID', 'ROLEFLOCK_TASK_ID']);

    // A user's existing verification command or hook reads the legacy name, so
    // during the transition a child process sees both.
    const child = withLegacyAlias({}, 'TASK_ID', 'task_1');
    expect(child).toEqual({ ROFLOCK_TASK_ID: 'task_1', ROLEFLOCK_TASK_ID: 'task_1' });
  });
});

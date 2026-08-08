import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  name: string;
  private?: boolean;
  bin: Record<string, string>;
  dependencies: Record<string, string>;
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest;

describe('published package contract', () => {
  it('publishes the unscoped package with package-relative executable paths', () => {
    expect(manifest.name).toBe('roflock');
    expect(manifest.private).not.toBe(true);
    expect(manifest.bin).toEqual({
      roflock: './dist/bin/roflock.js',
      'roflock-mcp': './dist/bin/roflock-mcp.js',
      roleflock: './dist/bin/roleflock.js',
    });
  });

  it('has no private workspace package in its consumer dependency closure', () => {
    expect(Object.keys(manifest.dependencies).some((name) => name.startsWith('@roleflock/'))).toBe(
      false,
    );
    expect(
      Object.values(manifest.dependencies).some((version) => version.startsWith('workspace:')),
    ).toBe(false);
  });
});

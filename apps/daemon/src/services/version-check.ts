import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv } from '@roleflock/contracts';

const PACKAGE_JSON = join(dirname(fileURLToPath(import.meta.url)), '../../package.json');

export interface VersionInfo {
  product: string;
  version: string;
  platform: string;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  checkedAt: string;
  channel: 'local' | 'remote';
  currentVersion: string;
  latestVersion?: string;
  note: string;
}

export function getLocalVersion(): VersionInfo {
  let version = '0.1.0';
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { version?: string };
    if (pkg.version) version = pkg.version;
  } catch {
    // keep fallback
  }
  return { product: 'Roflock', version, platform: process.platform };
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const local = getLocalVersion();
  const checkedAt = new Date().toISOString();
  const updateUrl = readEnv('UPDATE_URL');

  if (!updateUrl) {
    return {
      updateAvailable: false,
      checkedAt,
      channel: 'local',
      currentVersion: local.version,
      note: 'Update checks do not transmit repository contents',
    };
  }

  try {
    const response = await fetch(updateUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        product: local.product,
        version: local.version,
        platform: local.platform,
      }),
    });
    if (!response.ok) {
      return {
        updateAvailable: false,
        checkedAt,
        channel: 'remote',
        currentVersion: local.version,
        note: `Update check failed (${response.status}); no repository data was sent`,
      };
    }
    const data = (await response.json()) as { latestVersion?: string; updateAvailable?: boolean };
    const latestVersion = data.latestVersion;
    const updateAvailable =
      data.updateAvailable ?? Boolean(latestVersion && latestVersion !== local.version);
    return {
      updateAvailable,
      checkedAt,
      channel: 'remote',
      currentVersion: local.version,
      latestVersion,
      note: 'Update checks do not transmit repository contents',
    };
  } catch {
    return {
      updateAvailable: false,
      checkedAt,
      channel: 'remote',
      currentVersion: local.version,
      note: 'Update check offline; no repository data was sent',
    };
  }
}

import {
  KeychainError,
  OsKeychainSecretStore,
  createOsKeychain,
  type Keychain,
  type SecretStore,
} from '@roleflock/secret-store';
import { LocalSecretStore } from './local-secret-store.js';

/**
 * Where the passport signing key actually lives.
 *
 * This is reported in the Change Passport rather than assumed, because the two
 * cases carry different weight for whoever reviews the passport: an OS keychain
 * keeps the key out of the daemon's own data directory, while the local file
 * store holds its encryption key beside the ciphertext it protects, so anything
 * that can read the data directory can recover the key.
 */
export type SigningKeyProtection = 'os_keychain' | 'local_file';

export const SIGNING_KEYCHAIN_SERVICE = 'com.roleflock.runner-signing';
export const SIGNING_SECRET_NAMESPACE = 'runner-signing';

export interface SigningSecretStore {
  store: SecretStore;
  protection: SigningKeyProtection;
}

export interface SigningSecretStoreOptions {
  keychain?: Keychain | undefined;
  /** Injected so migration failures can be asserted without a real keychain. */
  log?: (event: { level: 'info' | 'warn'; message: string; error?: unknown }) => void;
}

/**
 * Resolves the store that holds passport signing keys, migrating any key left in
 * the local file store into the OS keychain on the way.
 *
 * A keychain that exists but refuses to answer is **not** a reason to fall back
 * to the file store. Falling back would quietly re-create the weaker protection
 * the user was told they had moved away from, and would let a passport keep
 * claiming keychain protection it no longer has. Instead the keychain store is
 * returned as-is, so signing fails closed with the keychain's own error until
 * the user unlocks it.
 */
export async function createSigningSecretStore(
  dataDir: string,
  options: SigningSecretStoreOptions = {},
): Promise<SigningSecretStore> {
  const keychain = options.keychain ?? createOsKeychain();
  const local = new LocalSecretStore(dataDir, SIGNING_SECRET_NAMESPACE);
  if (!keychain) return { store: local, protection: 'local_file' };

  const store = new OsKeychainSecretStore(SIGNING_KEYCHAIN_SERVICE, keychain);
  await migrateLocalSigningKeys(local, store, options.log);
  return { store, protection: 'os_keychain' };
}

/**
 * Moves signing keys out of the local file store, one id at a time.
 *
 * The old copy is only removed once the keychain returns the same value, so an
 * interrupted or half-failed migration leaves the key recoverable rather than
 * destroying the identity's ability to sign.
 */
async function migrateLocalSigningKeys(
  local: LocalSecretStore,
  keychain: SecretStore,
  log: SigningSecretStoreOptions['log'],
): Promise<void> {
  let ids: string[];
  try {
    ids = await local.listIds();
  } catch (error) {
    log?.({ level: 'warn', message: 'Unable to read local signing keys for migration', error });
    return;
  }
  if (ids.length === 0) return;

  const moved: string[] = [];
  for (const id of ids) {
    try {
      const value = await local.get(id);
      if (value === undefined) continue;
      if ((await keychain.get(id)) === undefined) await keychain.set(id, value);
      if ((await keychain.get(id)) !== value) {
        throw new Error('Keychain did not return the migrated signing key');
      }
      moved.push(id);
    } catch (error) {
      log?.({
        level: 'warn',
        message:
          error instanceof KeychainError && error.code === 'locked'
            ? `Keychain is locked, so signing key ${id} stays in the local file store. Unlock the keychain and restart to complete the move.`
            : `Unable to move signing key ${id} into the OS keychain`,
        error,
      });
      return;
    }
  }

  if (moved.length !== ids.length) return;
  await local.destroy();
  log?.({
    level: 'info',
    message: `Moved ${moved.length} signing key(s) into the OS keychain and removed the local key file`,
  });
}

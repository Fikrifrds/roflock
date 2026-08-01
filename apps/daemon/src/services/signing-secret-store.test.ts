import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeychainError, type Keychain } from '@roleflock/secret-store';
import { describe, expect, it } from 'vitest';
import { LocalSecretStore } from './local-secret-store.js';
import {
  SIGNING_SECRET_NAMESPACE,
  createSigningSecretStore,
  type SigningSecretStoreOptions,
} from './signing-secret-store.js';

function dataDir(): string {
  return mkdtempSync(join(tmpdir(), 'roleflock-signing-'));
}

class FakeKeychain implements Keychain {
  readonly values = new Map<string, string>();
  constructor(private readonly failWith?: Error) {}
  async getPassword(_service: string, account: string) {
    if (this.failWith) throw this.failWith;
    return this.values.get(account) ?? null;
  }
  async setPassword(_service: string, account: string, value: string) {
    if (this.failWith) throw this.failWith;
    this.values.set(account, value);
  }
  async deletePassword(_service: string, account: string) {
    return this.values.delete(account);
  }
}

function collectLogs(): {
  log: NonNullable<SigningSecretStoreOptions['log']>;
  messages: string[];
} {
  const messages: string[] = [];
  return { log: ({ message }) => void messages.push(message), messages };
}

const KEY_REF = 'roleflock.runner.abc123.ed25519';
const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2Vw\n-----END PRIVATE KEY-----\n';

describe('createSigningSecretStore', () => {
  it('reports local_file protection when the platform has no keychain', async () => {
    const dir = dataDir();
    const signing = await createSigningSecretStore(dir, { keychain: undefined });

    expect(signing.protection).toBe('local_file');
    await signing.store.set(KEY_REF, PRIVATE_KEY);
    await expect(signing.store.get(KEY_REF)).resolves.toBe(PRIVATE_KEY);
  });

  it('moves an existing local signing key into the keychain and deletes the key file', async () => {
    const dir = dataDir();
    await new LocalSecretStore(dir, SIGNING_SECRET_NAMESPACE).set(KEY_REF, PRIVATE_KEY);
    expect(existsSync(join(dir, `${SIGNING_SECRET_NAMESPACE}.key`))).toBe(true);

    const keychain = new FakeKeychain();
    const signing = await createSigningSecretStore(dir, { keychain });

    expect(signing.protection).toBe('os_keychain');
    await expect(signing.store.get(KEY_REF)).resolves.toBe(PRIVATE_KEY);
    // The encryption key must go too: leaving it behind keeps the old ciphertext
    // readable, which is exactly what moving to the keychain is meant to end.
    expect(existsSync(join(dir, `${SIGNING_SECRET_NAMESPACE}.key`))).toBe(false);
    expect(existsSync(join(dir, `${SIGNING_SECRET_NAMESPACE}.json`))).toBe(false);
  });

  it('keeps the local key when the keychain is locked, and does not fall back to it', async () => {
    const dir = dataDir();
    await new LocalSecretStore(dir, SIGNING_SECRET_NAMESPACE).set(KEY_REF, PRIVATE_KEY);
    const { log, messages } = collectLogs();

    const signing = await createSigningSecretStore(dir, {
      keychain: new FakeKeychain(new KeychainError('locked', 'locked', 36)),
      log,
    });

    // Fail closed: the store is still the keychain, so signing surfaces the
    // locked keychain instead of quietly signing with an on-disk key.
    expect(signing.protection).toBe('os_keychain');
    await expect(signing.store.get(KEY_REF)).rejects.toThrow(KeychainError);
    // The key is preserved so the move can finish after an unlock.
    expect(existsSync(join(dir, `${SIGNING_SECRET_NAMESPACE}.json`))).toBe(true);
    await expect(new LocalSecretStore(dir, SIGNING_SECRET_NAMESPACE).get(KEY_REF)).resolves.toBe(
      PRIVATE_KEY,
    );
    expect(messages.join(' ')).toContain('Unlock the keychain');
  });

  it('completes the move on the next start after the keychain is unlocked', async () => {
    const dir = dataDir();
    await new LocalSecretStore(dir, SIGNING_SECRET_NAMESPACE).set(KEY_REF, PRIVATE_KEY);
    await createSigningSecretStore(dir, {
      keychain: new FakeKeychain(new KeychainError('locked', 'locked', 36)),
    });

    const signing = await createSigningSecretStore(dir, { keychain: new FakeKeychain() });

    await expect(signing.store.get(KEY_REF)).resolves.toBe(PRIVATE_KEY);
    expect(existsSync(join(dir, `${SIGNING_SECRET_NAMESPACE}.key`))).toBe(false);
  });

  it('leaves an already-migrated keychain entry untouched', async () => {
    const dir = dataDir();
    const keychain = new FakeKeychain();
    keychain.values.set(KEY_REF, PRIVATE_KEY);

    const signing = await createSigningSecretStore(dir, { keychain });

    expect(signing.protection).toBe('os_keychain');
    await expect(signing.store.get(KEY_REF)).resolves.toBe(PRIVATE_KEY);
  });
});

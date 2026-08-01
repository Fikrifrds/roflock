import { execFile } from 'node:child_process';

export interface SecretStore { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void>; }

export class InMemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();
  async get(key: string) { return this.values.get(key); }
  async set(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}

export interface Keychain {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, value: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

/** Adapter boundary for keytar/OS keychain; injected so this package has no native dependency. */
export class OsKeychainSecretStore implements SecretStore {
  constructor(private readonly service: string, private readonly keychain: Keychain) {}
  async get(key: string) { return (await this.keychain.getPassword(this.service, key)) ?? undefined; }
  async set(key: string, value: string) { await this.keychain.setPassword(this.service, key, value); }
  async delete(key: string) { await this.keychain.deletePassword(this.service, key); }
}

/**
 * Why a keychain call can fail matters to the caller: `locked` is the user's to
 * resolve and worth retrying, while `failed` means the secret must be treated as
 * unavailable. Nothing here ever degrades to an on-disk key — a signing key that
 * silently falls back to a file is the exact outcome the keychain exists to stop.
 */
export type KeychainFailureCode = 'locked' | 'failed';

export class KeychainError extends Error {
  constructor(
    message: string,
    readonly code: KeychainFailureCode,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = 'KeychainError';
  }
}

export interface KeychainCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Injected so the command construction can be tested without a real keychain. */
export type KeychainCommandRunner = (
  file: string,
  args: readonly string[],
) => Promise<KeychainCommandResult>;

/** `security` reports errSecItemNotFound this way; every other status is an error. */
const ERR_SEC_ITEM_NOT_FOUND = 44;

export const SECURITY_BINARY = '/usr/bin/security';

/**
 * macOS keychain access through the `security` CLI rather than a native binding,
 * so the daemon gains keychain-backed signing keys without adding a compiled
 * dependency that has to be rebuilt per Node version and per architecture.
 *
 * Secrets are base64-wrapped before they are stored. A PEM private key contains
 * newlines and `find-generic-password -w` terminates its output with one, so an
 * unwrapped round-trip cannot tell the value's own trailing newline apart from
 * the one the tool added.
 *
 * Known limitation: `add-generic-password` takes the secret as an argument, so a
 * concurrently running process owned by another local account can observe it in
 * the process table during the write. Reads do not go through argv. This is
 * recorded in the threat model.
 */
export class MacOsSecurityKeychain implements Keychain {
  constructor(private readonly run: KeychainCommandRunner = runSecurityCommand) {}

  async getPassword(service: string, account: string): Promise<string | null> {
    const result = await this.run(SECURITY_BINARY, [
      'find-generic-password',
      '-s', service,
      '-a', account,
      '-w',
    ]);
    if (result.exitCode === ERR_SEC_ITEM_NOT_FOUND) return null;
    if (result.exitCode !== 0) throw keychainError('read', service, account, result);
    const encoded = result.stdout.replace(/\n$/, '');
    return Buffer.from(encoded, 'base64').toString('utf8');
  }

  async setPassword(service: string, account: string, value: string): Promise<void> {
    const result = await this.run(SECURITY_BINARY, [
      'add-generic-password',
      '-s', service,
      '-a', account,
      // -U updates an existing item instead of failing with errSecDuplicateItem.
      '-U',
      '-w', Buffer.from(value, 'utf8').toString('base64'),
    ]);
    if (result.exitCode !== 0) throw keychainError('write', service, account, result);
  }

  async deletePassword(service: string, account: string): Promise<boolean> {
    const result = await this.run(SECURITY_BINARY, [
      'delete-generic-password',
      '-s', service,
      '-a', account,
    ]);
    if (result.exitCode === ERR_SEC_ITEM_NOT_FOUND) return false;
    if (result.exitCode !== 0) throw keychainError('delete', service, account, result);
    return true;
  }
}

/**
 * The OS keychain for this platform, or `undefined` where none is wired up.
 *
 * Callers decide what an absent keychain means. The daemon keeps working with a
 * local encrypted file, but says so in the passport rather than implying the key
 * is protected by the OS.
 */
export function createOsKeychain(platform: NodeJS.Platform = process.platform): Keychain | undefined {
  return platform === 'darwin' ? new MacOsSecurityKeychain() : undefined;
}

function keychainError(
  operation: string,
  service: string,
  account: string,
  result: KeychainCommandResult,
): KeychainError {
  const detail = (result.stderr || result.stdout).trim();
  // A locked or non-interactive keychain is the common recoverable case, and the
  // user needs to be told to unlock it rather than shown a raw OSStatus.
  const locked = /interaction|not allowed|user (?:name|interaction)|locked|denied/i.test(detail);
  return new KeychainError(
    `Keychain ${operation} failed for ${service}/${account} (exit ${result.exitCode})${detail ? `: ${detail}` : ''}`,
    locked ? 'locked' : 'failed',
    result.exitCode,
  );
}

function runSecurityCommand(file: string, args: readonly string[]): Promise<KeychainCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: 15_000 }, (error, stdout, stderr) => {
      if (error && typeof (error as { code?: unknown }).code !== 'number') {
        // Spawn-level failure (missing binary, timeout): no exit status to read.
        reject(error);
        return;
      }
      resolve({
        stdout,
        stderr,
        exitCode: error ? ((error as unknown as { code: number }).code ?? 1) : 0,
      });
    });
  });
}

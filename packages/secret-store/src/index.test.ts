import { describe, expect, it } from 'vitest';
import {
  KeychainError,
  MacOsSecurityKeychain,
  SECURITY_BINARY,
  createOsKeychain,
  type KeychainCommandResult,
  type KeychainCommandRunner,
} from './index.js';

function runner(
  results: KeychainCommandResult | KeychainCommandResult[],
): { run: KeychainCommandRunner; calls: string[][] } {
  const queue = Array.isArray(results) ? [...results] : [results];
  const calls: string[][] = [];
  const run: KeychainCommandRunner = async (file, args) => {
    calls.push([file, ...args]);
    return queue.length > 1 ? queue.shift()! : queue[0]!;
  };
  return { run, calls };
}

const ok = (stdout = ''): KeychainCommandResult => ({ stdout, stderr: '', exitCode: 0 });

describe('MacOsSecurityKeychain', () => {
  it('round-trips a value whose own trailing newline would otherwise be ambiguous', async () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2Vw\n-----END PRIVATE KEY-----\n';
    const encoded = Buffer.from(pem, 'utf8').toString('base64');

    const write = runner(ok());
    await new MacOsSecurityKeychain(write.run).setPassword('svc', 'acct', pem);
    expect(write.calls[0]).toEqual([
      SECURITY_BINARY,
      'add-generic-password',
      '-s', 'svc',
      '-a', 'acct',
      '-U',
      '-w', encoded,
    ]);

    // `security` appends its own newline to the emitted secret.
    const read = runner(ok(`${encoded}\n`));
    await expect(new MacOsSecurityKeychain(read.run).getPassword('svc', 'acct')).resolves.toBe(pem);
  });

  it('reports a missing item as absent rather than as an error', async () => {
    const missing: KeychainCommandResult = { stdout: '', stderr: '', exitCode: 44 };
    await expect(
      new MacOsSecurityKeychain(runner(missing).run).getPassword('svc', 'acct'),
    ).resolves.toBeNull();
    await expect(
      new MacOsSecurityKeychain(runner(missing).run).deletePassword('svc', 'acct'),
    ).resolves.toBe(false);
  });

  it('classifies a locked keychain so the user can be told to unlock it', async () => {
    const locked: KeychainCommandResult = {
      stdout: '',
      stderr: 'SecKeychainSearchCopyNext: User interaction is not allowed.',
      exitCode: 36,
    };
    await expect(
      new MacOsSecurityKeychain(runner(locked).run).getPassword('svc', 'acct'),
    ).rejects.toMatchObject({ name: 'KeychainError', code: 'locked', exitCode: 36 });
  });

  it('never reports an unreadable secret as absent', async () => {
    const failure: KeychainCommandResult = { stdout: '', stderr: 'boom', exitCode: 1 };
    const error = await new MacOsSecurityKeychain(runner(failure).run)
      .getPassword('svc', 'acct')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KeychainError);
    expect((error as KeychainError).code).toBe('failed');
  });

  it('does not leak the secret into the failure message', async () => {
    const failure: KeychainCommandResult = { stdout: '', stderr: 'denied', exitCode: 51 };
    const error = await new MacOsSecurityKeychain(runner(failure).run)
      .setPassword('svc', 'acct', 'super-secret-key')
      .catch((caught: unknown) => caught);
    expect((error as KeychainError).message).not.toContain('super-secret-key');
  });
});

describe('createOsKeychain', () => {
  it('is available on macOS and absent elsewhere', () => {
    expect(createOsKeychain('darwin')).toBeInstanceOf(MacOsSecurityKeychain);
    expect(createOsKeychain('linux')).toBeUndefined();
    expect(createOsKeychain('win32')).toBeUndefined();
  });
});

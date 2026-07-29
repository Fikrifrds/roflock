import { verify as verifyBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { OsKeychainSecretStore } from '@roleflock/secret-store';
import { describe, expect, it } from 'vitest';
import {
  LocalRunnerIdentityService,
  dssePreAuthenticationEncoding,
  parseChangePassportPayload,
  publicKeyObject,
  type RunnerIdentity,
  type RunnerIdentityStore,
} from './index.js';

describe('local runner identity signing', () => {
  it('keeps the Ed25519 private key only in the secret-store boundary', async () => {
    const identities = new MemoryIdentityStore();
    const keychain = new FakeKeychain();
    const secrets = new OsKeychainSecretStore('dev.roleflock.runner', keychain);
    const service = new LocalRunnerIdentityService(
      identities,
      secrets,
      () => new Date('2026-07-28T10:00:00.000Z'),
    );

    const identity = await service.ensureIdentity();
    const privateKey = await secrets.get(identity.keyReference);
    expect(privateKey).toContain('BEGIN PRIVATE KEY');
    expect(JSON.stringify(identity)).not.toContain('PRIVATE KEY');
    expect(keychain.values.size).toBe(1);
    expect(identity.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(await service.ensureIdentity()).toEqual(identity);
    expect(identities.created).toHaveLength(1);

    const { envelope } = await service.sign(
      parseChangePassportPayload(fixture('passport-v1.json')),
    );
    expect(envelope.signatures).toHaveLength(1);
    expect(
      verifyBytes(
        null,
        dssePreAuthenticationEncoding(envelope.payloadType, envelope.payload),
        publicKeyObject(identity),
        Buffer.from(envelope.signatures[0]!.sig, 'base64'),
      ),
    ).toBe(true);
  });

  it('deletes a generated key if public identity persistence fails', async () => {
    const keychain = new FakeKeychain();
    const secrets = new OsKeychainSecretStore('dev.roleflock.runner', keychain);
    let reference = '';
    const service = new LocalRunnerIdentityService(
      {
        getActiveLocal: () => undefined,
        create(identity) {
          reference = identity.keyReference;
          throw new Error('database unavailable');
        },
      },
      secrets,
    );

    await expect(service.ensureIdentity()).rejects.toThrow(/database unavailable/);
    expect(await secrets.get(reference)).toBeUndefined();
    expect(keychain.values.size).toBe(0);
  });
});

class MemoryIdentityStore implements RunnerIdentityStore {
  readonly created: RunnerIdentity[] = [];

  getActiveLocal(): RunnerIdentity | undefined {
    return this.created.find((identity) => identity.status === 'active');
  }

  create(identity: RunnerIdentity): RunnerIdentity {
    this.created.push(identity);
    return identity;
  }
}

class FakeKeychain {
  readonly values = new Map<string, string>();

  async getPassword(service: string, account: string): Promise<string | null> {
    return this.values.get(`${service}:${account}`) ?? null;
  }

  async setPassword(service: string, account: string, value: string): Promise<void> {
    this.values.set(`${service}:${account}`, value);
  }

  async deletePassword(service: string, account: string): Promise<boolean> {
    return this.values.delete(`${service}:${account}`);
  }
}

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
}

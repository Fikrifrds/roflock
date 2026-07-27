import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface EncryptedValue {
  iv: string;
  tag: string;
  value: string;
}

/**
 * A small local fallback for credentials when an OS-keychain integration is
 * unavailable. Provider metadata stays in SQLite; this file is encrypted with
 * a separate, owner-only key held beside the daemon's local data.
 */
export class LocalSecretStore {
  private readonly keyPath: string;
  private readonly valuesPath: string;

  constructor(dataDir: string) {
    this.keyPath = join(dataDir, 'provider-secrets.key');
    this.valuesPath = join(dataDir, 'provider-secrets.json');
  }

  async get(id: string): Promise<string | undefined> {
    const item = this.readValues()[id];
    if (!item) return undefined;
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(item.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(item.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(item.value, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  }

  async set(id: string, value: string): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const values = this.readValues();
    values[id] = {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      value: encrypted.toString('base64'),
    };
    writeFileSync(this.valuesPath, JSON.stringify(values), { encoding: 'utf8', mode: 0o600 });
  }

  private key(): Buffer {
    if (!existsSync(this.keyPath)) writeFileSync(this.keyPath, randomBytes(32), { mode: 0o600 });
    return readFileSync(this.keyPath);
  }

  private readValues(): Record<string, EncryptedValue> {
    if (!existsSync(this.valuesPath)) return {};
    return JSON.parse(readFileSync(this.valuesPath, 'utf8')) as Record<string, EncryptedValue>;
  }
}

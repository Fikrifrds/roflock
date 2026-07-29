import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalRunnerIdentityService,
  parseChangePassportPayload,
  type RunnerIdentity,
  type RunnerIdentityStore,
} from '@roleflock/change-passport';
import { afterEach, describe, expect, it } from 'vitest';
import { runPassportCli } from './passport-command.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('roleflock passport verify CLI', () => {
  it('verifies a passport offline with supplied identity and subject files', async () => {
    const files = await signedFixture();
    const output: string[] = [];
    const errors: string[] = [];
    const exitCode = runPassportCli(
      [
        'passport',
        'verify',
        files.passport,
        '--identity',
        files.identity,
        '--subject',
        files.subject,
        '--revocation-current',
        '--now',
        '2026-07-28T10:01:00.000Z',
      ],
      { stdout: (value) => output.push(value), stderr: (value) => errors.push(value) },
    );

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(output.join('\n')).toContain('VALID SIGNATURE');
    expect(output.join('\n')).toContain('SUBJECT MATCH');
    expect(output.join('\n')).toContain('POLICY PASS');
    expect(output.join('\n')).toContain('REVOCATION STATUS: current');
  });

  it('returns a failing integrity exit code for a tampered payload', async () => {
    const files = await signedFixture();
    const envelope = JSON.parse(readFileSync(files.passport, 'utf8')) as {
      payload: string;
    };
    const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8')) as {
      taskId: string;
    };
    payload.taskId = 'tampered_task';
    envelope.payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    writeFileSync(files.passport, JSON.stringify(envelope));
    const output: string[] = [];
    const exitCode = runPassportCli(
      [
        'passport',
        'verify',
        files.passport,
        '--identity',
        files.identity,
        '--subject',
        files.subject,
        '--revocation-current',
      ],
      { stdout: (value) => output.push(value), stderr: () => {} },
    );
    expect(exitCode).toBe(1);
    expect(output.join('\n')).toContain('INVALID SIGNATURE');
  });

  it('reports unknown revocation separately without calling the passport active', async () => {
    const files = await signedFixture();
    const output: string[] = [];
    const exitCode = runPassportCli(
      ['passport', 'verify', files.passport, '--identity', files.identity],
      { stdout: (value) => output.push(value), stderr: () => {} },
    );
    expect(exitCode).toBe(0);
    expect(output.join('\n')).toContain('POLICY NOT ACCEPTED');
    expect(output.join('\n')).toContain('REVOCATION STATUS: unknown');
  });
});

async function signedFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'roleflock-passport-cli-'));
  directories.push(directory);
  const identities = new MemoryIdentities();
  const secrets = new MemorySecrets();
  const signer = new LocalRunnerIdentityService(
    identities,
    secrets,
    () => new Date('2026-07-28T10:00:00.000Z'),
  );
  const source = JSON.parse(
    readFileSync(
      new URL('../../../packages/change-passport/fixtures/passport-v1.json', import.meta.url),
      'utf8',
    ),
  );
  const payload = parseChangePassportPayload(source);
  const { identity, envelope } = await signer.sign(payload);
  const passport = join(directory, 'passport.json');
  const identityPath = join(directory, 'identity.json');
  const subject = join(directory, 'subject.json');
  writeFileSync(passport, JSON.stringify(envelope));
  writeFileSync(identityPath, JSON.stringify(identity));
  writeFileSync(subject, JSON.stringify(payload.subject));
  return { passport, identity: identityPath, subject };
}

class MemoryIdentities implements RunnerIdentityStore {
  value?: RunnerIdentity;
  getActiveLocal() {
    return this.value;
  }
  create(identity: RunnerIdentity) {
    this.value = identity;
    return identity;
  }
}

class MemorySecrets {
  values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key);
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async delete(key: string) {
    this.values.delete(key);
  }
}

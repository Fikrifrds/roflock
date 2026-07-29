import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
  type KeyObject,
} from 'node:crypto';
import type { SecretStore } from '@roleflock/secret-store';
import { z } from 'zod';
import {
  CHANGE_PASSPORT_PAYLOAD_TYPE,
  SignedChangePassportSchema,
  encodeChangePassportPayload,
  type ChangePassportPayload,
  type SignedChangePassport,
} from './index.js';

const IdentifierSchema = z.string().trim().min(1).max(240);
const TimestampSchema = z.string().datetime({ offset: true });

export const RunnerIdentitySchema = z
  .object({
    id: IdentifierSchema,
    kind: z.enum(['local_installation', 'organisation_runner', 'external_attestor']),
    algorithm: z.literal('ed25519'),
    keyId: IdentifierSchema,
    keyReference: IdentifierSchema,
    publicKey: z.string().includes('BEGIN PUBLIC KEY'),
    issuer: IdentifierSchema.optional(),
    validFrom: TimestampSchema,
    validUntil: TimestampSchema.optional(),
    status: z.enum(['active', 'rotated', 'revoked']),
  })
  .strict();
export type RunnerIdentity = z.infer<typeof RunnerIdentitySchema>;

export interface RunnerIdentityStore {
  getActiveLocal(): RunnerIdentity | undefined;
  create(identity: RunnerIdentity): RunnerIdentity;
}

export class LocalRunnerIdentityService {
  constructor(
    private readonly identities: RunnerIdentityStore,
    private readonly secrets: SecretStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureIdentity(): Promise<RunnerIdentity> {
    const existing = this.identities.getActiveLocal();
    if (existing) {
      if (!(await this.secrets.get(existing.keyReference))) {
        throw new Error(
          `Private signing key is unavailable in the OS secret store: ${existing.id}`,
        );
      }
      return existing;
    }

    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const keyId = createHash('sha256').update(publicKey).digest('hex');
    const identity = RunnerIdentitySchema.parse({
      id: `runner_${keyId.slice(0, 24)}`,
      kind: 'local_installation',
      algorithm: 'ed25519',
      keyId,
      keyReference: `roleflock.runner.${keyId}.ed25519`,
      publicKey,
      validFrom: this.now().toISOString(),
      status: 'active',
    });
    await this.secrets.set(identity.keyReference, privateKey);
    try {
      return this.identities.create(identity);
    } catch (error) {
      await this.secrets.delete(identity.keyReference);
      throw error;
    }
  }

  async sign(payload: ChangePassportPayload): Promise<{
    identity: RunnerIdentity;
    envelope: SignedChangePassport;
  }> {
    const identity = await this.ensureIdentity();
    if (identity.status !== 'active') throw new Error('Runner identity is not active');
    const privateKey = await this.secrets.get(identity.keyReference);
    if (!privateKey) throw new Error('Private signing key is unavailable in the OS secret store');
    const encodedPayload = encodeChangePassportPayload(payload);
    const signature = signBytes(
      null,
      dssePreAuthenticationEncoding(CHANGE_PASSPORT_PAYLOAD_TYPE, encodedPayload),
      privateKey,
    ).toString('base64');
    return {
      identity,
      envelope: SignedChangePassportSchema.parse({
        payloadType: CHANGE_PASSPORT_PAYLOAD_TYPE,
        payload: encodedPayload,
        signatures: [{ keyid: identity.keyId, sig: signature, algorithm: 'ed25519' }],
      }),
    };
  }
}

export function dssePreAuthenticationEncoding(payloadType: string, encodedPayload: string): Buffer {
  const payload = Buffer.from(encodedPayload, 'base64');
  const type = Buffer.from(payloadType, 'utf8');
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${type.length} `, 'utf8'),
    type,
    Buffer.from(` ${payload.length} `, 'utf8'),
    payload,
  ]);
}

export function publicKeyObject(identity: RunnerIdentity): KeyObject {
  return createPublicKey(RunnerIdentitySchema.parse(identity).publicKey);
}

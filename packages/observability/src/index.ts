import { sha256Canonical } from '@roleflock/contracts';

const SECRET_KEY = /(?:password|secret|token|api[_-]?key|authorization|cookie|private[_-]?key)/i;
const SECRET_VALUE = /(?:sk-[\w-]{12,}|Bearer\s+\S+|-----BEGIN[\s\S]*?KEY-----)/gi;

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[REDACTED]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key, SECRET_KEY.test(key) ? '[REDACTED]' : redact(item),
    ]));
  }
  return value;
}

export interface LogEntry { timestamp: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string; fields?: Record<string, unknown>; }
export interface Logger { debug(message: string, fields?: Record<string, unknown>): void; info(message: string, fields?: Record<string, unknown>): void; warn(message: string, fields?: Record<string, unknown>): void; error(message: string, fields?: Record<string, unknown>): void; child(fields: Record<string, unknown>): Logger; }

export function createLogger(base: Record<string, unknown> = {}, write: (entry: LogEntry) => void = (entry) => console.log(JSON.stringify(entry))): Logger {
  const emit = (level: LogEntry['level'], message: string, fields?: Record<string, unknown>) => write(redact({ timestamp: new Date().toISOString(), level, message, ...base, ...fields }) as LogEntry);
  return { debug: (m, f) => emit('debug', m, f), info: (m, f) => emit('info', m, f), warn: (m, f) => emit('warn', m, f), error: (m, f) => emit('error', m, f), child: (fields) => createLogger({ ...base, ...fields }, write) };
}

export type MetadataSyncRecord =
  | {
      type: 'task';
      taskId: string;
      projectId: string;
      state: string;
      risk: string;
      contractHash?: string;
      planHash?: string;
      updatedAt: string;
    }
  | {
      type: 'passport';
      passportId: string;
      taskId: string;
      resultCommit: string;
      payloadDigest: string;
      verdict: string;
      issuedAt: string;
      revoked: boolean;
    }
  | {
      type: 'runner';
      runnerIdentityId: string;
      keyId: string;
      trustStatus: string;
      updatedAt: string;
    }
  | {
      type: 'outcome';
      observationId: string;
      taskClass: string;
      roleId: string;
      profileVersion: string;
      outcome: string;
      metricsDigest: string;
      observedAt: string;
    };

export interface MetadataSyncEnvelope {
  schemaVersion: 1;
  organisationId: string;
  installationId: string;
  cursor: string;
  records: MetadataSyncRecord[];
  createdAt: string;
  hashAlgorithm: 'sha256';
  envelopeHash: string;
}

export function createMetadataSyncEnvelope(input: {
  organisationId: string;
  installationId: string;
  cursor: string;
  records: readonly MetadataSyncRecord[];
  createdAt: string;
}): MetadataSyncEnvelope {
  const unsigned = {
    schemaVersion: 1 as const,
    organisationId: input.organisationId,
    installationId: input.installationId,
    cursor: input.cursor,
    records: input.records.map(allowlistedMetadataRecord),
    createdAt: input.createdAt,
  };
  return {
    ...unsigned,
    hashAlgorithm: 'sha256',
    envelopeHash: sha256Canonical(unsigned),
  };
}

export function verifyMetadataSyncEnvelope(envelope: MetadataSyncEnvelope): boolean {
  const { envelopeHash, hashAlgorithm: _algorithm, ...unsigned } = envelope;
  return envelopeHash === sha256Canonical(unsigned);
}

function allowlistedMetadataRecord(record: MetadataSyncRecord): MetadataSyncRecord {
  switch (record.type) {
    case 'task':
      return {
        type: record.type,
        taskId: record.taskId,
        projectId: record.projectId,
        state: record.state,
        risk: record.risk,
        contractHash: record.contractHash,
        planHash: record.planHash,
        updatedAt: record.updatedAt,
      };
    case 'passport':
      return {
        type: record.type,
        passportId: record.passportId,
        taskId: record.taskId,
        resultCommit: record.resultCommit,
        payloadDigest: record.payloadDigest,
        verdict: record.verdict,
        issuedAt: record.issuedAt,
        revoked: record.revoked,
      };
    case 'runner':
      return {
        type: record.type,
        runnerIdentityId: record.runnerIdentityId,
        keyId: record.keyId,
        trustStatus: record.trustStatus,
        updatedAt: record.updatedAt,
      };
    case 'outcome':
      return {
        type: record.type,
        observationId: record.observationId,
        taskClass: record.taskClass,
        roleId: record.roleId,
        profileVersion: record.profileVersion,
        outcome: record.outcome,
        metricsDigest: record.metricsDigest,
        observedAt: record.observedAt,
      };
  }
}

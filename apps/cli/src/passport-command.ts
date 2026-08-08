import { readFileSync } from 'node:fs';
import {
  PassportRevocationSchema,
  PassportSubjectSchema,
  RunnerIdentitySchema,
  SignedChangePassportSchema,
  verifySignedChangePassport,
  type PassportVerificationResult,
} from '@roleflock/change-passport';
import { ExitCode } from './exit-codes.js';

export interface PassportCliIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

export function runPassportCli(args: string[], io: PassportCliIo): number {
  try {
    const parsed = parseArgs(args);
    const envelope = SignedChangePassportSchema.parse(readJson(parsed.passportPath));
    const signatureKeyIds = new Set(envelope.signatures.map((signature) => signature.keyid));
    const identities = identityList(readJson(parsed.identityPath));
    const identity = identities.find((candidate) => signatureKeyIds.has(candidate.keyId));
    if (!identity) throw new Error('No supplied trust identity matches a passport signature');
    const expectedSubject = parsed.subjectPath
      ? PassportSubjectSchema.parse(readJson(parsed.subjectPath))
      : undefined;
    const revocation = parsed.revocationPath
      ? PassportRevocationSchema.parse(readJson(parsed.revocationPath))
      : undefined;
    const result = verifySignedChangePassport({
      envelope,
      identity,
      expectedSubject,
      revocation,
      revocationSourceCurrent: parsed.revocationCurrent,
      now: parsed.now,
    });
    if (parsed.json) io.stdout(JSON.stringify(result, null, 2));
    else io.stdout(renderHuman(result));
    return integritySucceeded(result) ? ExitCode.Ok : ExitCode.RunFailed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.includes('--json')) {
      io.stderr(JSON.stringify({ error: { message, code: 'USAGE' }, exitCode: ExitCode.Usage }));
    } else io.stderr(message);
    return ExitCode.Usage;
  }
}

function parseArgs(args: string[]): {
  passportPath: string;
  identityPath: string;
  subjectPath?: string;
  revocationPath?: string;
  revocationCurrent: boolean;
  json: boolean;
  now?: Date;
} {
  if (args[0] !== 'passport' || args[1] !== 'verify' || !args[2]) {
    throw new Error(
      'Usage: roflock passport verify <passport.json> --identity <runner.json> [--subject <subject.json>] [--revocation <revocation.json> | --revocation-current] [--json]',
    );
  }
  const options = new Map<string, string>();
  const flags = new Set<string>();
  const valueOptions = new Set(['--identity', '--subject', '--revocation', '--now']);
  for (let index = 3; index < args.length; index += 1) {
    const token = args[index]!;
    if (['--json', '--revocation-current'].includes(token)) {
      flags.add(token);
      continue;
    }
    if (!valueOptions.has(token) || !args[index + 1]) {
      throw new Error(`Invalid CLI option: ${token}`);
    }
    options.set(token, args[index + 1]!);
    index += 1;
  }
  const identityPath = options.get('--identity');
  if (!identityPath) throw new Error('--identity is required for offline signature verification');
  if (options.has('--revocation') && flags.has('--revocation-current')) {
    throw new Error('Use either --revocation or --revocation-current, not both');
  }
  const nowValue = options.get('--now');
  const now = nowValue ? new Date(nowValue) : undefined;
  if (now && Number.isNaN(now.getTime())) throw new Error('--now must be an ISO timestamp');
  return {
    passportPath: args[2],
    identityPath,
    ...(options.get('--subject') ? { subjectPath: options.get('--subject')! } : {}),
    ...(options.get('--revocation') ? { revocationPath: options.get('--revocation')! } : {}),
    revocationCurrent: flags.has('--revocation-current'),
    json: flags.has('--json'),
    ...(now ? { now } : {}),
  };
}

function identityList(input: unknown) {
  const values = Array.isArray(input) ? input : [input];
  return values.map((identity) => RunnerIdentitySchema.parse(identity));
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function integritySucceeded(result: PassportVerificationResult): boolean {
  return (
    result.cryptographicValidity === 'valid' &&
    result.identityStatus === 'trusted' &&
    result.expiryStatus !== 'expired' &&
    result.revocationStatus !== 'revoked'
  );
}

function renderHuman(result: PassportVerificationResult): string {
  const payload = result.payload;
  return [
    `${result.cryptographicValidity === 'valid' ? 'VALID' : 'INVALID'} SIGNATURE`,
    `IDENTITY ${result.identityStatus.toUpperCase().replaceAll('_', ' ')}`,
    `SUBJECT ${result.subjectStatus.toUpperCase().replaceAll('_', ' ')}`,
    `POLICY ${result.accepted ? 'PASS' : 'NOT ACCEPTED'}`,
    payload
      ? `ASSURANCE: ${payload.assurance.issuerTrust.replaceAll('_', ' ')} + ${payload.assurance.verification.replaceAll('_', ' ')}`
      : 'ASSURANCE: unavailable',
    `REVOCATION STATUS: ${result.revocationStatus}`,
    ...(result.errors.length > 0 ? ['', ...result.errors.map((error) => `- ${error}`)] : []),
  ].join('\n');
}

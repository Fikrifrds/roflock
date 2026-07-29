import { relative, resolve } from 'node:path';
import { sha256Canonical } from '@roleflock/contracts';

export interface Policy {
  allowedPathGlobs?: string[];
  deniedPathGlobs?: string[];
  allowedCommands?: string[];
  deniedCommands?: string[];
}

export interface SharedPolicyBundle {
  schemaVersion: 1;
  id: string;
  organisationId: string;
  name: string;
  version: number;
  policy: Policy;
  credentialCapabilities: string[];
}

export interface SealedSharedPolicyBundle extends SharedPolicyBundle {
  digestAlgorithm: 'sha256';
  digest: string;
}

export function sealSharedPolicyBundle(bundle: SharedPolicyBundle): SealedSharedPolicyBundle {
  if (bundle.schemaVersion !== 1 || !bundle.id || !bundle.organisationId || !bundle.name) {
    throw new Error('Shared policy bundle identity is incomplete');
  }
  if (!Number.isInteger(bundle.version) || bundle.version < 1) {
    throw new Error('Shared policy bundle version must be a positive integer');
  }
  const normalized: SharedPolicyBundle = {
    ...bundle,
    policy: normalizePolicy(bundle.policy),
    credentialCapabilities: [...new Set(bundle.credentialCapabilities)].sort(),
  };
  return { ...normalized, digestAlgorithm: 'sha256', digest: sha256Canonical(normalized) };
}

export function verifySharedPolicyBundle(bundle: SealedSharedPolicyBundle): boolean {
  const { digest, digestAlgorithm: _algorithm, ...unsigned } = bundle;
  return sealSharedPolicyBundle(unsigned).digest === digest;
}

export function checkPath(
  policy: Policy,
  root: string,
  path: string,
): { allowed: boolean; reason?: string } {
  const normal = relative(root, resolve(root, path));
  if (!normal || normal.startsWith('..')) return { allowed: false, reason: 'path escapes root' };
  if (policy.deniedPathGlobs?.some((pattern) => glob(normal, pattern))) {
    return { allowed: false, reason: 'denied path pattern' };
  }
  if (
    policy.allowedPathGlobs &&
    !policy.allowedPathGlobs.some((pattern) => glob(normal, pattern))
  ) {
    return { allowed: false, reason: 'not an allowed path pattern' };
  }
  return { allowed: true };
}

export function checkCommand(
  policy: Policy,
  command: string,
  args: string[] = [],
): { allowed: boolean; reason?: string } {
  const actual = [command, ...args].join(' ');
  if (policy.deniedCommands?.some((pattern) => glob(actual, pattern) || glob(command, pattern))) {
    return { allowed: false, reason: 'denied command pattern' };
  }
  if (
    policy.allowedCommands &&
    !policy.allowedCommands.some((pattern) => glob(actual, pattern) || glob(command, pattern))
  ) {
    return { allowed: false, reason: 'not an allowed command pattern' };
  }
  return { allowed: true };
}

export function enforceSharedPathPolicies(
  bundles: readonly SealedSharedPolicyBundle[],
  root: string,
  path: string,
): { allowed: boolean; bundleId?: string; reason?: string } {
  for (const bundle of bundles) {
    if (!verifySharedPolicyBundle(bundle)) {
      return { allowed: false, bundleId: bundle.id, reason: 'policy bundle digest is invalid' };
    }
    const decision = checkPath(bundle.policy, root, path);
    if (!decision.allowed) return { ...decision, bundleId: bundle.id };
  }
  return { allowed: true };
}

export function enforceSharedCommandPolicies(
  bundles: readonly SealedSharedPolicyBundle[],
  command: string,
  args: string[] = [],
): { allowed: boolean; bundleId?: string; reason?: string } {
  for (const bundle of bundles) {
    if (!verifySharedPolicyBundle(bundle)) {
      return { allowed: false, bundleId: bundle.id, reason: 'policy bundle digest is invalid' };
    }
    const decision = checkCommand(bundle.policy, command, args);
    if (!decision.allowed) return { ...decision, bundleId: bundle.id };
  }
  return { allowed: true };
}

function normalizePolicy(policy: Policy): Policy {
  return Object.fromEntries(
    Object.entries(policy)
      .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))
      .map(([key, values]) => [key, [...new Set(values)].sort()]),
  );
}

function glob(value: string, pattern: string): boolean {
  return new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '§')
      .replace(/\*/g, '[^/]*')
      .replace(/§/g, '.*')}$`,
  ).test(value);
}

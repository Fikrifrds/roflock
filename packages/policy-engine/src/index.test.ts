import { describe, expect, it } from 'vitest';
import {
  enforceSharedCommandPolicies,
  sealSharedPolicyBundle,
  verifySharedPolicyBundle,
} from './index.js';

describe('shared policy bundles', () => {
  it('enforces every versioned bundle across agents and fails closed on tampering', () => {
    const base = sealSharedPolicyBundle({
      schemaVersion: 1,
      id: 'policy_1',
      organisationId: 'org_1',
      name: 'safe-shell',
      version: 1,
      policy: { allowedCommands: ['git *', 'npm test'], deniedCommands: ['git push *'] },
      credentialCapabilities: ['github.read'],
    });
    expect(verifySharedPolicyBundle(base)).toBe(true);
    expect(enforceSharedCommandPolicies([base], 'git', ['status'])).toEqual({ allowed: true });
    expect(enforceSharedCommandPolicies([base], 'git', ['push', 'origin'])).toMatchObject({
      allowed: false,
      bundleId: 'policy_1',
    });
    const tampered = structuredClone(base);
    tampered.policy.deniedCommands = [];
    expect(enforceSharedCommandPolicies([tampered], 'git', ['status'])).toMatchObject({
      allowed: false,
      reason: 'policy bundle digest is invalid',
    });
  });
});

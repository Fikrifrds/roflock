import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CURATED_PROFILE_BUNDLE,
  loadCuratedProfileBundle,
  sealCuratedProfileBundle,
  verifyCuratedProfileBundle,
} from './curated-bundle.js';

describe('versioned curated profile bundle', () => {
  it('loads a frozen cold-start bundle with explicit version and provenance', () => {
    const bundle = loadCuratedProfileBundle(DEFAULT_CURATED_PROFILE_BUNDLE);
    expect(bundle.bundleVersion).toBe('2026.7.1');
    expect(bundle.scoringVersions).toContain('rolefit-1.0.0');
    expect(bundle.profiles.length).toBeGreaterThanOrEqual(6);
    expect(Object.isFrozen(bundle)).toBe(true);
    for (const profile of bundle.profiles) {
      expect(profile.profileVersion).toBe(bundle.bundleVersion);
      expect(profile.evidenceSources.every((source) => source.kind === 'curated')).toBe(true);
      expect(
        Object.values(profile.traits).every(
          (trait) => trait.source === 'curated' && trait.confidence < 0.7,
        ),
      ).toBe(true);
    }
  });

  it('detects bundle tampering and incompatible scoring versions', () => {
    const tampered = structuredClone(DEFAULT_CURATED_PROFILE_BUNDLE);
    tampered.profiles[0]!.traits.planning_depth!.score = 0;
    expect(verifyCuratedProfileBundle(tampered)).toBe(false);
    expect(() => loadCuratedProfileBundle(tampered)).toThrow(/digest is invalid/);
    expect(() => loadCuratedProfileBundle(DEFAULT_CURATED_PROFILE_BUNDLE, 'rolefit-2.0.0')).toThrow(
      /incompatible/,
    );
  });

  it('keeps earlier profile objects pinned when a new bundle is sealed', () => {
    const pinned = structuredClone(DEFAULT_CURATED_PROFILE_BUNDLE.profiles[0]!);
    const next = sealCuratedProfileBundle({
      bundleVersion: '2026.8.0',
      publishedAt: '2026-08-01T10:00:00.000Z',
      scoringVersions: ['rolefit-1.0.0'],
      profiles: DEFAULT_CURATED_PROFILE_BUNDLE.profiles.map((profile) => ({
        ...structuredClone(profile),
        profileVersion: '2026.8.0',
        effectiveAt: '2026-08-01T10:00:00.000Z',
      })),
    });
    expect(next.bundleVersion).toBe('2026.8.0');
    expect(pinned.profileVersion).toBe('2026.7.1');
    expect(DEFAULT_CURATED_PROFILE_BUNDLE.profiles[0]).toEqual(pinned);
  });
});

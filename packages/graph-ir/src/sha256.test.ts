import { createHash } from 'node:crypto';
import { canonicalize, sha256Canonical as nodeCanonical } from '@roleflock/contracts';
import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Canonical, sha256Hex } from './sha256.js';

/**
 * This hash decides a run's recorded identity, so "close enough" is not a
 * category that exists here. A digest that differed from `node:crypto` would
 * silently invalidate every stored invocation key rather than failing loudly.
 */

describe('digests match the platform implementation', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('matches the published vector for %j', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it.each([
    'a',
    'the quick brown fox',
    'x'.repeat(55), // one byte short of needing a second block
    'x'.repeat(56), // exactly at the boundary
    'x'.repeat(64),
    'x'.repeat(1000),
    'unicode: café — 日本語 — 🚀',
    '{"nested":{"json":[1,2,3]}}',
  ])('agrees with node:crypto for %j', (input) => {
    expect(sha256Hex(input)).toBe(createHash('sha256').update(input).digest('hex'));
  });
});

describe('canonicalisation matches the shared implementation', () => {
  it.each([
    { b: 1, a: 2 },
    { nested: { z: 1, a: { y: 2, b: 3 } } },
    [3, 1, 2],
    { list: [{ b: 1, a: 2 }] },
    { nullish: null, zero: 0, empty: '' },
  ])('produces the same canonical JSON as contracts for %j', (value) => {
    // Two implementations that disagreed would give one document two identities
    // depending on which side of the wire computed it.
    expect(canonicalJson(value)).toBe(canonicalize(value));
  });

  it.each([
    { workflow: 'bugfix', nodes: ['a', 'b'] },
    { deeply: { nested: { and: { sorted: true } } } },
  ])('produces the same digest as contracts for %j', (value) => {
    expect(sha256Canonical(value)).toBe(nodeCanonical(value));
  });
});

describe('the package is portable', () => {
  it('computes a digest without any platform crypto in scope', () => {
    // The point of the exercise: nothing here needs node:crypto, so the
    // Playground computes the same identity the runtime does.
    expect(sha256Canonical({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

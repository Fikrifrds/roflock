import { describe, expect, it } from 'vitest';
import { stopIsConfirmable } from '@roleflock/provider-core';
import { shippedDriverCancellation } from '../src/services/cancellation.js';

/**
 * The floor the interface is allowed to promise.
 *
 * This pins the honesty property rather than the current value: whatever the
 * drivers report, the daemon must report the weakest of them, because a UI
 * warning derived from the best case is absent exactly on the runs that need it.
 */

describe('the stop guarantee the daemon reports', () => {
  it('is not confirmable while every driver spawns a local CLI', async () => {
    const capability = await shippedDriverCancellation();

    expect(capability).toBe('local-process');
    // The claim the UI is built on. If this ever flips, the caveat disappears
    // from the task view, so it must flip for a real reason.
    expect(stopIsConfirmable(capability)).toBe(false);
  });

  it('never reports better than the weakest driver', async () => {
    // `remote-confirmed` is the seed of the fold. A reduce that started from the
    // first element, or picked the max, would return the best driver's answer
    // and quietly authorise the interface to over-promise for the others.
    expect(await shippedDriverCancellation()).not.toBe('remote-confirmed');
  });
});

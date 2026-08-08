import { claudeDriver } from '@roleflock/provider-claude';
import { codexDriver } from '@roleflock/provider-codex';
import { openCodeDriver } from '@roleflock/provider-opencode';
import type { CancellationCapability } from '@roleflock/provider-core';

/**
 * The weakest stop guarantee among the drivers a run could land on.
 *
 * Weakest, not best: this answer drives what the UI promises a human, and a
 * promise that only holds for some providers is one that will be wrong exactly
 * when it matters. Reporting the floor means the interface can never claim more
 * than the run in front of it can deliver.
 *
 * Derived from the drivers rather than written down as a constant. Today every
 * one of them spawns a local CLI and so reports `local-process` — but that is a
 * fact about the current drivers, not a fact about Roflock, and hard-coding it
 * would leave the UI quietly lying in the opposite direction on the day a
 * provider can confirm a remote stop.
 */

const ORDER: CancellationCapability[] = [
  'none',
  'local-process',
  'cooperative',
  'remote-confirmed',
];

export async function shippedDriverCancellation(): Promise<CancellationCapability> {
  const capabilities = await Promise.all(
    [claudeDriver(), codexDriver(), openCodeDriver()].map(
      async (driver) => (await driver.capabilities()).cancellation,
    ),
  );

  return capabilities.reduce(
    (weakest: CancellationCapability, capability: CancellationCapability) =>
      ORDER.indexOf(capability) < ORDER.indexOf(weakest) ? capability : weakest,
    'remote-confirmed' as CancellationCapability,
  );
}

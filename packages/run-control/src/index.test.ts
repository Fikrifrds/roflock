import { describe, expect, it } from 'vitest';
import { ProcessSupervisor } from './index.js';
describe('ProcessSupervisor', () => {
  it('only reports stop acknowledged while heartbeat is fresh', async () => {
    const supervised = new ProcessSupervisor().spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { cwd: process.cwd() },
    );
    supervised.heartbeat();
    await expect(supervised.requestStop()).resolves.toBe(true);
    await expect(supervised.done).resolves.toBe('stopped');
  });
});

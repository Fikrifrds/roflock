import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReviewAppService } from '../src/services/review-app.js';

const services: ReviewAppService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});

describe('review app service', () => {
  it('opens a static index through an isolated preview origin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'roleflock-preview-'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Reviewed app</title>');
    const service = new ReviewAppService();
    services.push(service);

    expect(service.inspect('task-1', root)).toMatchObject({
      available: true,
      mode: 'static',
      state: 'ready',
    });
    const preview = await service.start('task-1', root);
    expect(preview).toMatchObject({ available: true, mode: 'static', state: 'running' });
    expect(preview.url).toMatch(/^http:\/\/localhost:/);
    await expect(fetch(preview.url!)).resolves.toMatchObject({ status: 200 });
    expect(await (await fetch(preview.url!)).text()).toContain('Reviewed app');
  });

  it('prefers a declared dev script over treating a framework entry file as static', () => {
    const root = mkdtempSync(join(tmpdir(), 'roleflock-preview-app-'));
    writeFileSync(join(root, 'index.html'), '<div id="root"></div>');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    const service = new ReviewAppService();
    services.push(service);

    expect(service.inspect('task-2', root)).toMatchObject({
      available: true,
      mode: 'run',
      state: 'ready',
      command: 'npm run dev',
    });
  });
});

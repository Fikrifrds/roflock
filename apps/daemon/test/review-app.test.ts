import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ReviewAppService,
  contentTypeFor,
  isPythonHttpServerScript,
  resolvePreviewLaunch,
} from '../src/services/review-app.js';

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

  it('treats python http.server + index.html as a static preview', async () => {
    const root = mkdtempSync(join(tmpdir(), 'roleflock-preview-py-'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Note</title>');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'simple-note', scripts: { start: 'python3 -m http.server 8000' } }),
    );
    const service = new ReviewAppService();
    services.push(service);

    expect(service.inspect('task-py', root)).toMatchObject({
      available: true,
      mode: 'static',
      state: 'ready',
    });
    const preview = await service.start('task-py', root);
    expect(preview.mode).toBe('static');
    expect(preview.state).toBe('running');
    await expect(fetch(preview.url!)).resolves.toMatchObject({ status: 200 });
  });

  it('serves ES modules with a JavaScript MIME type', async () => {
    const root = mkdtempSync(join(tmpdir(), 'roleflock-preview-mjs-'));
    mkdirSync(join(root, 'lib'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<script type="module" src="/lib/notes-store.mjs"></script>');
    writeFileSync(join(root, 'lib/notes-store.mjs'), 'export const ok = true;\n');
    const service = new ReviewAppService();
    services.push(service);

    const preview = await service.start('task-mjs', root);
    const response = await fetch(new URL('/lib/notes-store.mjs', preview.url!).href);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/javascript/);
    expect(await response.text()).toContain('export const ok');
  });
});

describe('contentTypeFor', () => {
  it('maps module and asset extensions browsers care about', () => {
    expect(contentTypeFor('lib/notes-store.mjs')).toMatch(/javascript/);
    expect(contentTypeFor('app.cjs')).toMatch(/javascript/);
    expect(contentTypeFor('styles.css')).toMatch(/text\/css/);
    expect(contentTypeFor('icon.svg')).toMatch(/svg/);
    expect(contentTypeFor('font.woff2')).toMatch(/font\/woff2/);
  });
});

describe('resolvePreviewLaunch', () => {
  it('maps python http.server to bind/port flags it actually accepts', () => {
    expect(isPythonHttpServerScript('python3 -m http.server 8000')).toBe(true);
    expect(resolvePreviewLaunch('npm', 'start', 'python3 -m http.server 8000', 50713)).toEqual({
      command: 'python3',
      args: ['-m', 'http.server', '50713', '-b', 'localhost'],
      env: { PORT: '50713', HOST: 'localhost' },
    });
  });

  it('keeps Vite-style host/port flags for typical JS scripts', () => {
    expect(resolvePreviewLaunch('npm', 'dev', 'vite', 4173)).toEqual({
      command: 'npm',
      args: ['run', 'dev', '--', '--host', 'localhost', '--port', '4173'],
      env: { PORT: '4173', HOST: 'localhost' },
    });
  });
});

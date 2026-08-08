import { describe, expect, it, vi } from 'vitest';
import { ROFLOCK_MCP_TOOLS, RoflockMcpOperations } from './mcp-server.js';

const SOURCE = `workflow sample { version "1.0.0" max_cost 1 }
role reader { readonly }
agent inspect { role reader objective "Inspect" }
human accept { title "Accept" decisions approve, reject }
flow { inspect -> accept }
`;

describe('Roflock MCP contract', () => {
  it('exposes compile/read/run tools but never approval delegation', () => {
    expect(ROFLOCK_MCP_TOOLS).toEqual([
      'roflock_check',
      'roflock_compile',
      'roflock_run',
      'roflock_status',
      'roflock_events',
    ]);
    expect(ROFLOCK_MCP_TOOLS.some((name) => /approve|reject/i.test(name))).toBe(false);
  });

  it('checks and compiles source through the public language pipeline', () => {
    const operations = new RoflockMcpOperations({
      dataDir: '/not-used',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    expect(operations.check(SOURCE)).toMatchObject({ executable: true, counts: { nodes: 2 } });
    expect(operations.compile(SOURCE)).toMatchObject({
      executable: true,
      graphIr: { workflow: { id: 'sample' } },
    });
  });

  it('starts the exact source through the existing daemon API', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'roflock-mcp-'));
    writeFileSync(join(dataDir, 'session.json'), JSON.stringify({ token: 'token', csrf: 'csrf' }));
    const requests: Array<{ url: string; body: unknown }> = [];
    const operations = new RoflockMcpOperations({
      dataDir,
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
        return new Response(
          String(url).endsWith('/api/projects')
            ? JSON.stringify({ id: 'project-1' })
            : JSON.stringify({
                accepted: true,
                taskId: 'task-1',
                graphRunId: 'run-1',
                workflowId: 'sample',
                semanticHash: 'sha256:test',
              }),
        );
      }) as typeof fetch,
    });
    try {
      await expect(
        operations.run({ source: SOURCE, repository: '/repo', brief: 'Inspect it' }),
      ).resolves.toMatchObject({ graphRunId: 'run-1' });
      expect(requests).toHaveLength(2);
      expect(requests[1]!.body).toMatchObject({ source: SOURCE, allowUncontracted: true });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const entry = resolve(process.argv[2] ?? 'apps/cli/dist/bin/roflock-mcp.js');
const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
let buffer = '';
let settled = false;

child.stderr.on('data', (chunk) => {
  stderr += String(chunk);
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

const completion = new Promise((resolvePromise, reject) => {
  const timeout = setTimeout(() => reject(new Error(`MCP smoke timed out\n${stderr}`)), 10_000);
  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    child.kill('SIGTERM');
    if (error) reject(error);
    else resolvePromise(value);
  };

  child.on('error', (error) => finish(error));
  child.on('exit', (code) => {
    if (!settled) finish(new Error(`MCP server exited early (${code})\n${stderr}`));
  });
  child.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines.filter(Boolean)) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        finish(new Error(`MCP server emitted non-JSON stdout: ${line}`));
        return;
      }
      if (message.id === 1) {
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      } else if (message.id === 2) {
        const names = message.result?.tools?.map((tool) => tool.name);
        const expected = [
          'roflock_check',
          'roflock_compile',
          'roflock_run',
          'roflock_status',
          'roflock_events',
        ];
        if (JSON.stringify(names) !== JSON.stringify(expected)) {
          finish(new Error(`Unexpected MCP tools: ${JSON.stringify(names)}`));
          return;
        }
        if (names.some((name) => /approve|reject/i.test(name))) {
          finish(new Error('MCP must not expose approval delegation'));
          return;
        }
        finish(undefined, names);
      }
    }
  });
});

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'roflock-package-smoke', version: '1.0.0' },
  },
});

const names = await completion;
process.stdout.write(`${JSON.stringify({ transport: 'stdio', tools: names })}\n`);

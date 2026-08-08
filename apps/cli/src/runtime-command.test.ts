import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExitCode } from './exit-codes.js';
import { runWorkflow } from './runtime-command.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'roflock-runtime-cli-'));
  directories.push(directory);
  const workflow = join(directory, 'workflow.roflock');
  const repository = join(directory, 'repository');
  writeFileSync(workflow, 'role writer { write }\nagent Build { role writer }\n');
  writeFileSync(
    join(directory, 'session.json'),
    JSON.stringify({ token: 't'.repeat(32), csrf: 'c'.repeat(16) }),
  );
  return { directory, workflow, repository };
}

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
    stdout,
    stderr,
  };
}

describe('roflock run', () => {
  it('registers the repository and starts exact source through the daemon', async () => {
    const { directory, workflow, repository } = fixture();
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/projects')) {
        return new Response(JSON.stringify({ id: 'project_1' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          accepted: true,
          taskId: 'task_1',
          graphRunId: 'run_1',
          workflowId: 'demo',
          semanticHash: `sha256:${'a'.repeat(64)}`,
          contract: { mode: 'legacy_uncontracted', warning: 'explicit warning' },
        }),
        { status: 202 },
      );
    }) as typeof fetch;
    const output = capture();

    const code = await runWorkflow(
      [workflow, '--repo', repository, '--brief', 'Ship it'],
      output.io,
      { clientOptions: { dataDir: directory, fetch: fetchMock } },
    );

    expect(code).toBe(ExitCode.Ok);
    expect(requests.map((request) => request.url)).toEqual([
      'http://127.0.0.1:4178/api/projects',
      'http://127.0.0.1:4178/api/runtime/runs',
    ]);
    const runtimeBody = JSON.parse(String(requests[1]!.init?.body)) as Record<string, unknown>;
    expect(runtimeBody).toMatchObject({
      projectId: 'project_1',
      brief: 'Ship it',
      allowUncontracted: true,
    });
    expect(runtimeBody.source).toBe('role writer { write }\nagent Build { role writer }\n');
    expect(output.stdout.join('\n')).toContain('Run run_1 started');
    expect(output.stderr.join('\n')).toContain('explicit warning');
  });

  it('keeps JSON output machine-readable and maps daemon failures', async () => {
    const { directory, workflow, repository } = fixture();
    const output = capture();
    const fetchMock = (async () =>
      new Response(JSON.stringify({ error: 'workflow is invalid' }), {
        status: 422,
      })) as typeof fetch;

    const code = await runWorkflow(
      [workflow, '--repo', repository, '--brief', 'Ship it', '--json'],
      output.io,
      { clientOptions: { dataDir: directory, fetch: fetchMock } },
    );

    expect(code).toBe(ExitCode.Usage);
    expect(output.stdout).toEqual([]);
    expect(JSON.parse(output.stderr[0]!)).toEqual({
      error: { message: 'workflow is invalid', httpStatus: 422 },
      exitCode: ExitCode.Usage,
    });
  });

  it('rejects incomplete arguments before reading daemon credentials', async () => {
    const output = capture();
    const code = await runWorkflow([], output.io);

    expect(code).toBe(ExitCode.Usage);
    expect(output.stderr[0]).toContain('Usage: roflock run');
  });
});

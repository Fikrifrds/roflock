import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExitCode } from './exit-codes.js';
import { runApprovalCommand, type Approval } from './approval-command.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

const approval: Approval = {
  id: 'approval_1',
  taskId: 'task_1',
  graphRunId: 'run_1',
  nodeRunId: 'node_1',
  requestType: 'command_execution',
  rationale: 'Run release verification',
  exactAction: { kind: 'command', verb: 'run', command: 'pnpm test' },
  commandPreview: 'pnpm test',
  riskClass: 'medium',
  stateHash: 'state_1',
  fingerprint: 'fingerprint_1',
  status: 'pending',
  createdAt: '2026-08-09T00:00:00.000Z',
};

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'roflock-approval-cli-'));
  directories.push(directory);
  writeFileSync(
    join(directory, 'session.json'),
    JSON.stringify({ token: 't'.repeat(32), csrf: 'c'.repeat(16) }),
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    directory,
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
    stdout,
    stderr,
  };
}

describe('approval commands', () => {
  it('lists pending approvals for an explicit run and exits blocked', async () => {
    const test = fixture();
    let requested = '';
    const fetchMock = (async (url: string | URL | Request) => {
      requested = String(url);
      return new Response(JSON.stringify([approval]), { status: 200 });
    }) as typeof fetch;
    expect(
      await runApprovalCommand('approvals', ['--run', 'run_1'], test.io, {
        clientOptions: { dataDir: test.directory, fetch: fetchMock },
      }),
    ).toBe(ExitCode.Blocked);
    expect(requested).toContain('/api/approvals?runId=run_1');
    expect(test.stdout[0]).toContain('approval_1');
  });

  it('inspects the exact action before a decision', async () => {
    const test = fixture();
    const fetchMock = (async () =>
      new Response(JSON.stringify(approval), { status: 200 })) as typeof fetch;
    expect(
      await runApprovalCommand('approval', ['approval_1'], test.io, {
        clientOptions: { dataDir: test.directory, fetch: fetchMock },
      }),
    ).toBe(ExitCode.Blocked);
    expect(test.stdout.join('\n')).toContain('pnpm test');
    expect(test.stdout.join('\n')).toContain('Run release verification');
  });

  it.each(['approve', 'reject'] as const)(
    'resolves only the named approval via %s',
    async (decision) => {
      const test = fixture();
      let requested = '';
      const decided = { ...approval, status: decision === 'approve' ? 'approved' : 'rejected' };
      const fetchMock = (async (url: string | URL | Request) => {
        requested = String(url);
        return new Response(JSON.stringify({ accepted: true, approval: decided }), { status: 200 });
      }) as typeof fetch;
      expect(
        await runApprovalCommand(decision, ['approval_1', '--json'], test.io, {
          clientOptions: { dataDir: test.directory, fetch: fetchMock },
        }),
      ).toBe(ExitCode.Ok);
      expect(requested).toContain(`/api/approvals/approval_1/${decision}`);
      expect(JSON.parse(test.stdout[0]!).approval.status).toBe(decided.status);
    },
  );

  it('does not accept an implicit approval id', async () => {
    const test = fixture();
    expect(await runApprovalCommand('approve', [], test.io)).toBe(ExitCode.Usage);
    expect(test.stderr[0]).toContain('<approval-id>');
  });
});

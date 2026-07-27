import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { GraphRunView } from '../src/components/GraphRunView.js';
import { Approvals } from '../src/routes/Approvals.js';
import { Home } from '../src/routes/Home.js';
import { NewTask } from '../src/routes/NewTask.js';
import { Evidence } from '../src/routes/Evidence.js';
import { renderApp, stubApi } from './render.js';

const RUNTIME = { '/api/runtime/info': { csrf: 'csrf' } };

function authenticated() {
  localStorage.setItem('roleflock-token', 'tok');
}

describe('Home', () => {
  it('summarises daemon health, approvals, and tasks', async () => {
    authenticated();
    stubApi({
      ...RUNTIME,
      '/api/health': { ok: true, host: '127.0.0.1', port: 4178 },
      '/api/tasks': [
        {
          id: 't1',
          title: 'Fix login',
          type: 'bug_fix',
          state: 'running',
          risk: 'medium',
          brief: '',
          maxAttempts: 3,
          workflowGraphVersionId: 'bug_fix@1',
        },
      ],
      '/api/approvals': [
        { id: 'a1', requestType: 'file_write', rationale: 'x', riskClass: 'low', fingerprint: 'f' },
      ],
      '/api/usage/summary': { actualCostUsd: 0.12, shadowCostUsd: 0.4 },
    });

    renderApp(<Home />);

    expect(await screen.findByText(/Daemon healthy on 127.0.0.1:4178/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /1 approval waiting/ })).toBeInTheDocument();
    expect(await screen.findByText('Fix login')).toBeInTheDocument();
    // Actual and shadow are never summed into one number.
    expect(await screen.findByText('$0.1200 actual · $0.4000 shadow')).toBeInTheDocument();
  });
});

describe('NewTask', () => {
  it('directs the user to Projects when none exist', async () => {
    authenticated();
    stubApi({ ...RUNTIME, '/api/projects': [], '/api/workflows': [], '/api/task-intents': [] });

    renderApp(<NewTask />);
    expect(
      await screen.findByText(/Add a project first, then come back to create a task/),
    ).toBeInTheDocument();
  });

  it('defaults the workflow to the recommendation and lets the user override it', async () => {
    authenticated();
    stubApi({
      ...RUNTIME,
      '/api/projects': [{ id: 'p1', name: 'Repo', resolvedPath: '/tmp/repo', status: 'ready' }],
      '/api/workflows': [
        { id: 'bug_fix', label: 'Verified Bug Fix', description: '' },
        { id: 'direct', label: 'Direct', description: '' },
      ],
      '/api/task-intents': [
        { id: 'bug_fix', label: 'Fix a Bug', description: '' },
        { id: 'investigation', label: 'Investigate', description: '' },
      ],
      '/api/workflows/recommend': {
        mode: 'bug_fix',
        label: 'Verified Bug Fix',
        rationale: 'Bug fixes use the verified fix path.',
      },
    });

    renderApp(<NewTask />);

    const workflow = await screen.findByRole('combobox', { name: /Workflow/ });
    await waitFor(() => expect(workflow).toHaveTextContent('Verified Bug Fix'));
    expect(screen.getByText(/Suggested workflow: Verified Bug Fix/)).toBeInTheDocument();
    // The recommended entry says so in its own description, not only in the
    // paragraph above the field.
    await userEvent.click(workflow);
    expect(screen.getByRole('option', { name: /Verified Bug Fix/ })).toHaveTextContent(
      'Recommended',
    );

    await userEvent.click(screen.getByRole('option', { name: /Direct/ }));
    expect(workflow).toHaveTextContent('Direct');
    expect(await screen.findByText(/\(overridden\)/)).toBeInTheDocument();
  });

  it('marks the selected intent for assistive technology', async () => {
    authenticated();
    stubApi({
      ...RUNTIME,
      '/api/projects': [{ id: 'p1', name: 'Repo', resolvedPath: '/tmp/repo', status: 'ready' }],
      '/api/workflows': [],
      '/api/task-intents': [
        { id: 'bug_fix', label: 'Fix a Bug', description: '' },
        { id: 'investigation', label: 'Investigate', description: '' },
      ],
      '/api/workflows/recommend': { mode: 'bug_fix', label: 'Verified Bug Fix', rationale: '' },
    });

    renderApp(<NewTask />);

    const bug = await screen.findByRole('button', { name: /Fix a Bug/ });
    const investigate = await screen.findByRole('button', { name: /Investigate/ });
    expect(bug).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(investigate);
    expect(investigate).toHaveAttribute('aria-pressed', 'true');
    expect(bug).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Approvals', () => {
  it('shows an empty inbox when nothing is waiting', async () => {
    authenticated();
    stubApi({ ...RUNTIME, '/api/approvals': [] });

    renderApp(<Approvals />);
    expect(await screen.findByText(/Nothing waiting/)).toBeInTheDocument();
  });

  it('offers a reuse grant after approving a task-linked request', async () => {
    authenticated();
    stubApi({
      ...RUNTIME,
      '/api/approvals': [
        {
          id: 'a1',
          taskId: 't1',
          requestType: 'file_write',
          rationale: 'Writer wants to edit src/',
          riskClass: 'medium',
          fingerprint: 'fp-1',
        },
      ],
      '/api/tasks/t1': { projectId: 'p1' },
    });

    renderApp(<Approvals />);

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByRole('region', { name: 'Remember this approval' }),
    ).toBeInTheDocument();
  });
});

describe('Evidence', () => {
  it('summarises outcome, diff, tests, and warnings before the raw ledger', async () => {
    authenticated();
    stubApi({
      ...RUNTIME,
      '/api/tasks/t1': { id: 't1', state: 'awaiting_acceptance' },
      '/api/evidence/tasks/t1': {
        findings: [{ id: 'f1', severity: 'warning', summary: 'Review this' }],
        testRuns: [
          { id: 'tr1', passed: 1, command: 'pnpm test' },
          { id: 'tr2', passed: 0, command: 'pnpm lint' },
        ],
        artefacts: [
          {
            id: 'a1',
            kind: 'diff',
            metadata_json: JSON.stringify({
              changedFiles: ['src/a.ts', 'src/b.ts'],
              added: 12,
              removed: 3,
            }),
          },
        ],
        disclosures: [],
      },
      '/api/usage/tasks/t1': { summary: { actualCostUsd: 0.02, shadowCostUsd: 0.1 } },
    });

    renderApp(
      <Routes>
        <Route path="/tasks/:id/evidence" element={<Evidence />} />
      </Routes>,
      { route: '/tasks/t1/evidence' },
    );

    const summary = await screen.findByRole('generic', { name: 'Verification summary' });
    await waitFor(() => {
      expect(summary).toHaveTextContent('awaiting acceptance');
      expect(summary).toHaveTextContent('2 files · +12/−3');
      expect(summary).toHaveTextContent('1 passed · 1 failed');
      expect(summary).toHaveTextContent('$0.0200');
    });
  });
});

describe('GraphRunView', () => {
  it('renders node states, gates, and failure routes read-only', async () => {
    authenticated();
    stubApi({
      ...RUNTIME,
      '/api/tasks/t1/graph': {
        taskId: 't1',
        graphRunId: 'r1',
        runState: 'running',
        graph: {
          id: 'bug_fix',
          version: 'bug_fix@1',
          label: 'Verified Bug Fix',
          description: '',
          maxConcurrency: 1,
          maxLoopIterations: 3,
          edges: [
            { from: 'writer', to: 'test', when: 'always' },
            { from: 'test', to: 'writer', when: 'on_fail' },
          ],
          nodes: [
            {
              id: 'writer',
              role: 'writer',
              kind: 'agent',
              dependsOn: [],
              required: false,
              writer: true,
              maxAttempts: 2,
              state: 'completed',
              outcome: 'success',
              startedAt: null,
              completedAt: null,
              attempts: 1,
            },
            {
              id: 'test',
              role: 'test',
              kind: 'test',
              dependsOn: ['writer'],
              required: true,
              writer: false,
              maxAttempts: 1,
              state: 'running',
              outcome: null,
              startedAt: null,
              completedAt: null,
              attempts: 1,
            },
          ],
        },
      },
    });

    renderApp(<GraphRunView taskId="t1" />);

    const nodes = await screen.findByRole('list', { name: 'Workflow graph nodes' });
    expect(within(nodes).getByText('writer')).toBeInTheDocument();
    expect(within(nodes).getByText(/Agent · writer · up to 2 attempts/)).toBeInTheDocument();
    expect(within(nodes).getByText(/Deterministic check · required gate/)).toBeInTheDocument();

    // Only the failure edge is surfaced; the happy path is already the node order.
    const routes = screen.getByRole('list', { name: 'Failure routes' });
    expect(within(routes).getByText(/test → writer/)).toBeInTheDocument();
    expect(within(routes).queryByText(/writer → test/)).not.toBeInTheDocument();
  });
});

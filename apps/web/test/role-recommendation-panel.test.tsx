import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RoleRecommendationPanel } from '../src/components/RoleRecommendationPanel.js';
import type { RecommendedRoleView, StoredRoleRecommendationView, Task } from '../src/types.js';
import { renderApp, stubApi } from './render.js';

const task: Task = {
  id: 'task_1',
  projectId: 'project_1',
  title: 'Protect checkout',
  type: 'feature',
  state: 'ready',
  risk: 'high',
  brief: 'Protect checkout delivery.',
  maxAttempts: 3,
  workflowGraphVersionId: 'standard@2',
};

describe('RoleRecommendationPanel', () => {
  it('shows fit, confidence, role boundaries, fallback, and applies the complete roster', async () => {
    const fetchMock = stubApi({
      '/api/tasks/task_1/role-recommendations/latest': stored,
      '/api/role-recommendations/recommendation_1/apply': stored,
    });
    renderApp(<RoleRecommendationPanel task={task} />);

    expect(await screen.findByText('A constraint-valid roster is ready')).toBeInTheDocument();
    expect(screen.getByText(/Must follow the approved plan/)).toBeInTheDocument();
    expect(screen.getAllByText(/independently revalidated/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/confidence/).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'Apply recommended roster' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([path]) => path === '/api/role-recommendations/recommendation_1/apply',
      );
      expect(call?.[1]).toMatchObject({
        method: 'POST',
        headers: expect.objectContaining({
          'if-match': '0',
          'idempotency-key': expect.any(String),
        }),
      });
    });
  });

  it('requires a reason and submits a per-role eligible override', async () => {
    const fetchMock = stubApi({
      '/api/tasks/task_1/role-recommendations/latest': stored,
      '/api/role-recommendations/recommendation_1/override': stored,
    });
    renderApp(<RoleRecommendationPanel task={task} />);
    const plannerLabel = await screen.findByText('Planner');
    const card = plannerLabel.closest('article');
    expect(card).not.toBeNull();
    await userEvent.click(within(card!).getByText('Override this role'));
    await userEvent.click(within(card!).getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: /codex \/ gpt-5.6-terra/ }));
    await userEvent.type(
      within(card!).getByPlaceholderText('Why is this alternative better for this task?'),
      'Prefer lower cost for this bounded planning task.',
    );
    await userEvent.click(within(card!).getByRole('button', { name: 'Apply audited override' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([path]) => path === '/api/role-recommendations/recommendation_1/override',
      );
      expect(call?.[1]).toMatchObject({
        method: 'POST',
        headers: expect.objectContaining({ 'if-match': '0' }),
      });
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
        role: 'planner',
        providerId: 'codex',
        modelId: 'gpt-5.6-terra',
        reason: 'Prefer lower cost for this bounded planning task.',
      });
    });
  });
});

const roles: RecommendedRoleView[] = ['planner', 'plan_critic', 'executor', 'verifier'];
const candidates = roles.flatMap((role, roleIndex) => [
  {
    role,
    providerId: role === 'verifier' ? 'claude' : 'codex',
    modelId: role === 'verifier' ? 'sonnet' : 'gpt-5.6-sol',
    modelFamily: role === 'verifier' ? 'sonnet' : 'gpt-5.6-sol',
    effort: 'high',
    rank: 1,
    selected: true,
    fallback: false,
    eligible: true,
    score: 0.88 - roleIndex * 0.01,
    confidence: 0.72,
    profileVersion: '2026.7.1',
    rationale: ['Strong role-specific weighted traits.', 'All required capabilities are known.'],
    knownGaps: [],
    violations: [],
  },
  {
    role,
    providerId: role === 'planner' ? 'codex' : 'claude',
    modelId: role === 'planner' ? 'gpt-5.6-terra' : 'opus',
    effort: 'medium',
    rank: 2,
    selected: false,
    fallback: true,
    eligible: true,
    score: 0.7,
    confidence: 0.61,
    profileVersion: '2026.7.1',
    rationale: ['Eligible fallback.'],
    knownGaps: [],
    violations: [],
  },
]);

const stored: StoredRoleRecommendationView = {
  recommendation: {
    id: 'recommendation_1',
    taskId: task.id,
    risk: 'high',
    recommendationVersion: 'role-recommendation-1.0.0',
    profileBundleVersion: '2026.7.1',
    profileBundleDigest: 'a'.repeat(64),
    scoringVersion: 'rolefit-1.0.0',
    inputHash: 'b'.repeat(64),
    complete: true,
    requiredRoles: roles,
    candidates,
    independence: [
      {
        leftRole: 'executor',
        rightRole: 'verifier',
        property: 'different_model_family',
        level: 'required',
        satisfied: true,
        known: true,
        reason: 'Model families differ',
      },
    ],
    gaps: [],
    generatedAt: '2026-07-28T12:00:00.000Z',
  },
  actions: [],
  revision: 0,
};

import type { GraphRunView, Task } from '../types.js';

const STAGES = [
  { id: 'plan', label: 'Plan', nodes: ['planner'] },
  { id: 'approve', label: 'Approve', nodes: ['reviewer'] },
  { id: 'write', label: 'Implement', nodes: ['writer'] },
  { id: 'test', label: 'Test', nodes: ['test'] },
  { id: 'verify', label: 'Verify', nodes: ['verifier'] },
  { id: 'accept', label: 'Accept', nodes: ['accept'] },
] as const;

function stageState(
  nodeStates: string[],
  taskState: string,
  stageId: (typeof STAGES)[number]['id'],
) {
  if (nodeStates.some((state) => state === 'running')) return 'active';
  if (nodeStates.some((state) => state === 'failed' || state === 'interrupted')) return 'blocked';
  if (nodeStates.length && nodeStates.every((state) => state === 'completed')) return 'complete';
  if (
    (stageId === 'approve' && taskState === 'awaiting_confirmation') ||
    (stageId === 'accept' && taskState === 'awaiting_acceptance')
  )
    return 'attention';
  if (stageId === 'accept' && taskState === 'accepted') return 'complete';
  return 'upcoming';
}

export function TaskJourney({ task, runView }: { task: Task; runView?: GraphRunView }) {
  const nodes = runView?.graph.nodes ?? [];
  return (
    <section className="task-journey" aria-label="Task lifecycle">
      <div className="journey-intro">
        <span className="eyebrow">Delivery path</span>
        <strong>Plan to verified acceptance</strong>
      </div>
      <ol>
        {STAGES.map((stage, index) => {
          const matching = nodes.filter((node) =>
            (stage.nodes as readonly string[]).includes(node.role),
          );
          const state = stageState(
            matching.map((node) => node.state),
            task.state,
            stage.id,
          );
          return (
            <li className={`journey-${state}`} key={stage.id}>
              <span>{state === 'complete' ? '✓' : index + 1}</span>
              <div>
                <strong>{stage.label}</strong>
                <small>
                  {state === 'complete'
                    ? 'Complete'
                    : state === 'active'
                      ? 'In progress'
                      : state === 'attention'
                        ? 'Needs you'
                        : state === 'blocked'
                          ? 'Needs review'
                          : 'Upcoming'}
                </small>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

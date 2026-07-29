import { Link } from 'react-router-dom';
import { formatTaskState, taskStateTone } from '../lib/format.js';
import type { Task } from '../types.js';
import { StatusPill } from './primitives.js';

export function TaskCard({ task }: { task: Task }) {
  return (
    <Link className="row task" to={`/tasks/${task.id}`}>
      <div>
        <b>{task.title}</b>
        <small>{task.type.replaceAll('_', ' ')}</small>
      </div>
      <StatusPill tone={taskStateTone(task.state)}>{formatTaskState(task.state)}</StatusPill>
    </Link>
  );
}

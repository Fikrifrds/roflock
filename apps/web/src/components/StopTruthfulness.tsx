import { useData } from '../lib/client.js';

/**
 * What "Stop" is actually able to promise.
 *
 * The buttons beside this used to imply a stop was a stop — "Kill the active
 * process immediately" describes what happens locally and says nothing about
 * the request already in flight to a paid provider, which keeps running and
 * keeps billing. A human who reads that and walks away believes they have
 * halted work and capped spend. Neither is true.
 *
 * The daemon reports the capability rather than this component assuming it, so
 * the wording follows the drivers instead of having to be remembered when one
 * of them can finally confirm a remote stop.
 */

interface Cancellation {
  capability: 'none' | 'local-process' | 'cooperative' | 'remote-confirmed';
  confirmable: boolean;
  activeTurns?: number;
}

export function StopTruthfulness({ taskId }: { taskId: string }) {
  const { data } = useData<Cancellation>(
    ['task-cancellation', taskId],
    `/api/tasks/${taskId}/cancellation`,
  );

  // Silent until the answer is known. Guessing here would defeat the point.
  if (!data) return null;
  // A confirmable stop needs no caveat — and must not carry one, or the warning
  // becomes noise people learn to scroll past.
  if (data.confirmable) return null;

  if (data.capability === 'none') {
    return (
      <p role="note" className="quiet">
        No interruptible harness turn is active. Cancelling stops Roflock scheduling, but cannot
        claim external work has stopped.
      </p>
    );
  }

  return (
    <p role="note" className="quiet">
      Stopping ends the local process. Work already sent to the provider may continue and may still
      be billed — this run cannot confirm a remote stop.
    </p>
  );
}

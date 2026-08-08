import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ActiveExecution } from '../src/types.js';
import { LiveTurn } from '../src/components/LiveTurn.js';

/**
 * The live view must say what the agent is allowed to do, not only who it is.
 *
 * `permissionProfileId` reached the browser from the start and nothing rendered
 * it, so an operator watching a turn could see the provider and the model and
 * still have no idea whether the thing running was able to modify their
 * repository. That is the single most consequential fact on the screen.
 */

function execution(permissionProfileId: string): ActiveExecution {
  return {
    phase: 'working',
    roleDisplayName: 'Writer',
    providerDisplayName: 'Claude',
    configuredModelDisplayName: 'Opus',
    permissionProfileId,
    lastHeartbeatAt: '2026-01-01T00:00:00.000Z',
    attempt: 1,
  };
}

describe('the authority shown for a live turn', () => {
  it('says plainly when a turn may write to the worktree', () => {
    render(<LiveTurn execution={execution('worktree-write')} finished={false} />);

    expect(screen.getByLabelText('Turn authority')).toBeTruthy();
    expect(screen.getByText('May write to the worktree')).toBeTruthy();
  });

  it('says a read-only turn cannot change your code', () => {
    render(<LiveTurn execution={execution('read-only')} finished={false} />);

    // Phrased as the consequence. "read-only" is a config value; "cannot change
    // your code" is the thing the operator is actually deciding about.
    expect(screen.getByText(/cannot change your code/)).toBeTruthy();
  });

  it('shows nothing rather than guessing when no profile is reported', () => {
    const { permissionProfileId: _omitted, ...rest } = execution('read-only');

    render(<LiveTurn execution={rest as ActiveExecution} finished={false} />);

    // Defaulting to "read-only" here would be the dangerous guess: it reassures
    // about a restriction nothing confirmed was applied.
    expect(screen.queryByLabelText('Turn authority')).toBeNull();
  });
});

/**
 * Documented process exit codes for the `roflock` executable.
 *
 * These are an automation contract: scripts and CI branch on them, so a code's
 * meaning may not be repurposed once released. Adding a new class is safe;
 * changing what an existing number means is not.
 *
 * `Ok` and `Internal` follow the usual shell convention. Everything else names
 * a specific, actionable class so a caller can tell "your workflow is wrong"
 * apart from "the run legitimately failed" apart from "a driver broke" without
 * parsing output.
 */
export const ExitCode = {
  /** The command did what it was asked to do. */
  Ok: 0,
  /** Unexpected internal error — a bug in Roflock, not in the user's input. */
  Internal: 1,
  /** Bad usage, unparseable source, or a workflow that fails validation. */
  Usage: 2,
  /** Configuration or environment is wrong: missing profile, unusable data directory. */
  Config: 3,
  /** The run itself failed: a check did not pass, a node exhausted its budget. */
  RunFailed: 4,
  /** Execution stopped at a gate and needs a human decision before it can continue. */
  Blocked: 5,
  /** Interrupted or cancelled, by signal or by an explicit control command. */
  Cancelled: 6,
  /** A driver or provider failed in a way that is not the workflow's fault. */
  Driver: 7,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

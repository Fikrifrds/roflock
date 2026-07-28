export type TaskFinding = { severity: string; summary: string; details?: string };

export function isMissingVerificationFinding(finding: TaskFinding | undefined): boolean {
  return Boolean(
    finding?.summary.includes('Verification command required') ||
    finding?.details?.includes('Verification command required') ||
    finding?.details?.includes('missing-verification-command') ||
    finding?.details?.includes('No verification command'),
  );
}

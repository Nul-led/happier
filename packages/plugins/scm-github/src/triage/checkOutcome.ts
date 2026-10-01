const FAILING_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'action_required',
  'startup_failure',
]);
const NEUTRAL_CONCLUSIONS = new Set(['neutral', 'skipped', 'cancelled', 'stale']);

function isGithubFailingCheckConclusion(value: string | undefined | null): boolean {
  return value !== undefined && value !== null && FAILING_CONCLUSIONS.has(value);
}

/** Browser-safe provider outcome shared by rollups and detail projections. */
export function readGithubCheckOutcomeV1(
  observation: Readonly<{ status: string; conclusion?: string | null }>,
): 'passed' | 'failed' | 'pending' | 'neutral' | 'unknown' {
  if (observation.status !== 'completed') return 'pending';
  if (isGithubFailingCheckConclusion(observation.conclusion)) return 'failed';
  if (observation.conclusion === 'success') return 'passed';
  if (observation.conclusion != null && NEUTRAL_CONCLUSIONS.has(observation.conclusion)) return 'neutral';
  return 'unknown';
}

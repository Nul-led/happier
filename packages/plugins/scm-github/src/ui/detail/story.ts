import type { GithubChecksViewV1 } from './panelReaders.js';
import type { GithubProjectedCheckRowV1 } from '../../triage/detail/projection.js';
import { readGithubCheckOutcomeV1 } from '../../triage/checkOutcome.js';

export function githubCheckToneV1(row: GithubProjectedCheckRowV1): 'success' | 'danger' | 'warning' | 'neutral' {
  const outcome = readGithubCheckOutcomeV1(row);
  if (outcome === 'passed') return 'success';
  if (outcome === 'failed') return 'danger';
  if (outcome === 'pending') return 'warning';
  return 'neutral';
}

/**
 * The GitHub facts the Overview story rail draws (r0.42): ② what changed and
 * the checks state. Pure, so the rail and its tests read one answer.
 */

export type GithubChecksStepV1 =
  | Readonly<{ state: 'failed'; count: number }>
  | Readonly<{ state: 'running' }>
  | Readonly<{ state: 'passed' }>;

/**
 * The checks marker: failing checks are ✕ with their count, running checks the
 * spinner, all passing ✓. With no checks, or no settled answer, there is no
 * checks step at all rather than a marker that claims a state.
 */
export function githubChecksStepV1(view: GithubChecksViewV1): GithubChecksStepV1 | null {
  if (view.state === 'none' || view.state === 'unknown') return null;
  const rowState = view.rowState;
  if (rowState === undefined) return null;
  if (rowState.kind === 'failing') return Object.freeze({ state: 'failed', count: rowState.failingCount });
  if (rowState.kind === 'running') return Object.freeze({ state: 'running' });
  return Object.freeze({ state: 'passed' });
}

type ChangedFileV1 = Readonly<{ path: string; additions: number; deletions: number }>;

export type GithubChangeSummaryV1<TRow extends ChangedFileV1> = Readonly<{
  additions: number;
  deletions: number;
  /** Files counted so far; the whole pull request only when `more` is false. */
  fileCount: number;
  /** The largest files, by lines changed, in that order. */
  files: readonly TRow[];
  /** Files read but not drawn as bars. */
  smallerCount: number;
  /** GitHub has more changed files than the pages read so far. */
  more: boolean;
}>;

export function githubChangeSummaryV1<TRow extends ChangedFileV1>(input: Readonly<{
  rows: readonly TRow[];
  more: boolean;
  shown: number;
}>): GithubChangeSummaryV1<TRow> {
  let additions = 0;
  let deletions = 0;
  for (const row of input.rows) {
    additions += row.additions;
    deletions += row.deletions;
  }
  const files = [...input.rows]
    .sort((left, right) => (right.additions + right.deletions) - (left.additions + left.deletions))
    .slice(0, input.shown);
  return Object.freeze({
    additions,
    deletions,
    fileCount: input.rows.length,
    files: Object.freeze(files),
    smallerCount: input.rows.length - files.length,
    more: input.more,
  });
}

import { describe, expect, it } from 'vitest';

import { githubChangeSummaryV1, githubCheckToneV1, githubChecksStepV1 } from './story.js';

const view = (patch: Partial<Parameters<typeof githubChecksStepV1>[0]>): Parameters<typeof githubChecksStepV1>[0] => ({
  headRevision: 'abc',
  state: 'resolved',
  rows: [],
  omittedRowCount: 0,
  projectionTruncated: false,
  ...patch,
});

describe('the GitHub checks step on the story rail', () => {
  it('keeps neutral and unreported completed outcomes distinct from failures', () => {
    const row = { key: 'github-check-run:1', resourceKind: 'check-run' as const, name: 'build', status: 'completed' };
    expect(githubCheckToneV1({ ...row, conclusion: 'skipped' })).toBe('neutral');
    expect(githubCheckToneV1({ ...row, conclusion: 'unrecognized' })).toBe('neutral');
    expect(githubCheckToneV1(row)).toBe('neutral');
    expect(githubCheckToneV1({ ...row, conclusion: 'failure' })).toBe('danger');
  });

  it('marks failing checks as failed, counted in words', () => {
    expect(githubChecksStepV1(view({ rowState: { kind: 'failing', failingCount: 2 } })))
      .toEqual({ state: 'failed', count: 2 });
  });

  it('marks running checks with the spinner, and all passing with a check', () => {
    expect(githubChecksStepV1(view({ rowState: { kind: 'running' } }))).toEqual({ state: 'running' });
    expect(githubChecksStepV1(view({ rowState: { kind: 'allPassing' } }))).toEqual({ state: 'passed' });
  });

  it('draws no checks step when GitHub reports no checks or no settled answer', () => {
    expect(githubChecksStepV1(view({ state: 'none' }))).toBeNull();
    expect(githubChecksStepV1(view({ state: 'unknown' }))).toBeNull();
  });
});

describe('the GitHub change summary on the story rail', () => {
  const file = (path: string, additions: number, deletions: number) => ({ path, additions, deletions });

  it('shows the largest files first and counts the rest as smaller files', () => {
    const summary = githubChangeSummaryV1({
      rows: [file('a', 1, 0), file('b', 90, 70), file('c', 40, 38), file('d', 5, 5), file('e', 52, 6)],
      more: false,
      shown: 3,
    });
    expect(summary.files.map((row) => row.path)).toEqual(['b', 'c', 'e']);
    expect(summary).toMatchObject({ additions: 188, deletions: 119, fileCount: 5, smallerCount: 2, more: false });
  });

  it('says the totals are partial while more pages remain unread', () => {
    const summary = githubChangeSummaryV1({ rows: [file('a', 3, 1)], more: true, shown: 4 });
    expect(summary).toMatchObject({ additions: 3, deletions: 1, fileCount: 1, smallerCount: 0, more: true });
  });
});

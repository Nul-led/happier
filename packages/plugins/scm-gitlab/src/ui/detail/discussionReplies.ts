import type { GitlabProjectedNoteRowV1 } from '../../triage/detail/projection.js';

/**
 * The reader's window over one returned discussion thread.
 *
 * `sources/SCM.md` §4.6 opens a discussion at its latest four returned notes and
 * offers `Show 4 earlier replies`. The count is the whole point: a control that
 * revealed the entire thread at once would defeat the reading window on the long
 * threads it exists for, and its own label would be false.
 *
 * The window is client-local over notes the boundary already published. GitLab
 * documents no per-discussion note cursor, so expanding it issues no provider
 * request and can never invent a nested HTTP page.
 */
export const GITLAB_DISCUSSION_REPLY_WINDOW_V1 = 4;

/** The replies still older than the current window. */
export function earlierGitlabDiscussionReplyCountV1(
  notes: readonly GitlabProjectedNoteRowV1[],
  visibleCount: number,
): number {
  return Math.max(0, notes.length - visibleCount);
}

/**
 * The visible replies, newest last.
 *
 * The window grows from the end, so an expansion adds older replies above the
 * ones already on screen and never reorders what the reader is looking at.
 */
export function projectGitlabDiscussionRepliesV1(
  notes: readonly GitlabProjectedNoteRowV1[],
  visibleCount: number,
): readonly GitlabProjectedNoteRowV1[] {
  return visibleCount >= notes.length
    ? notes
    : notes.slice(notes.length - Math.max(0, visibleCount));
}

/** One press of `Show 4 earlier replies`, bounded by the thread itself. */
export function expandGitlabDiscussionRepliesV1(
  visibleCount: number,
  totalCount: number,
): number {
  return Math.min(totalCount, visibleCount + GITLAB_DISCUSSION_REPLY_WINDOW_V1);
}

import { describe, expect, it } from 'vitest';

import {
  GITLAB_DISCUSSION_REPLY_WINDOW_V1,
  earlierGitlabDiscussionReplyCountV1,
  expandGitlabDiscussionRepliesV1,
  projectGitlabDiscussionRepliesV1,
} from './discussionReplies.js';

function replies(count: number) {
  return Array.from({ length: count }, (_unused, index) => ({
    id: String(index + 1),
    body: `reply ${String(index + 1)}`,
    system: false,
  }));
}

describe('the GitLab discussion reply window', () => {
  it('opens at the latest four replies', () => {
    const notes = replies(6);
    expect(projectGitlabDiscussionRepliesV1(notes, GITLAB_DISCUSSION_REPLY_WINDOW_V1)
      .map((note) => note.id)).toEqual(['3', '4', '5', '6']);
    expect(earlierGitlabDiscussionReplyCountV1(notes, GITLAB_DISCUSSION_REPLY_WINDOW_V1)).toBe(2);
  });

  it('adds exactly four earlier replies per expansion rather than the whole thread', () => {
    const notes = replies(13);
    let visible = GITLAB_DISCUSSION_REPLY_WINDOW_V1;
    const windows: number[][] = [];
    for (let expansion = 0; expansion < 4; expansion += 1) {
      windows.push(projectGitlabDiscussionRepliesV1(notes, visible).map((note) => Number(note.id)));
      visible = expandGitlabDiscussionRepliesV1(visible, notes.length);
    }

    expect(windows.map((window) => window.length)).toEqual([4, 8, 12, 13]);
    // Chronological order is preserved at every window: the control adds older
    // replies above the ones already on screen, it does not reorder them.
    expect(windows[3]).toEqual(Array.from({ length: 13 }, (_unused, index) => index + 1));
    expect(windows[1]?.[0]).toBe(6);
    expect(earlierGitlabDiscussionReplyCountV1(notes, visible)).toBe(0);
  });

  it('offers no earlier-reply control for a thread that already shows everything', () => {
    const notes = replies(4);
    expect(earlierGitlabDiscussionReplyCountV1(notes, GITLAB_DISCUSSION_REPLY_WINDOW_V1)).toBe(0);
    expect(projectGitlabDiscussionRepliesV1(notes, GITLAB_DISCUSSION_REPLY_WINDOW_V1))
      .toHaveLength(4);
    expect(expandGitlabDiscussionRepliesV1(GITLAB_DISCUSSION_REPLY_WINDOW_V1, notes.length)).toBe(4);
  });
});

import { describe, expect, it } from 'vitest';

import {
  NOT_STARTED_VIEWER_READ_STATE_V1,
  ViewerReadStateV1Schema,
  projectLegacyViewerUnreadSinceV1,
  projectLegacyViewerLastViewedSessionSeqV1,
  projectViewerReadStateV1,
} from './readState.js';

describe('projectViewerReadStateV1', () => {
  it('reports not_started when no viewer row exists', () => {
    expect(projectViewerReadStateV1({ tracked: true, row: null, visibleSessionSeq: 9 }))
      .toEqual({ state: 'not_started' });
  });

  it('hides a retained but inert cursor from an untracked viewer', () => {
    expect(projectViewerReadStateV1({
      tracked: false,
      row: { lastViewedSessionSeq: 4, unreadSince: 1_700 },
      visibleSessionSeq: 9,
    })).toEqual({ state: 'not_started' });
  });

  it('clamps a tracked frontier to the viewer-visible publication ceiling', () => {
    expect(projectViewerReadStateV1({
      tracked: true,
      row: { lastViewedSessionSeq: 12, unreadSince: null },
      visibleSessionSeq: 7,
    })).toEqual({ state: 'tracking', lastViewedSessionSeq: 7, unreadSince: null });
  });

  it('preserves the private unread-entry instant while tracked', () => {
    expect(projectViewerReadStateV1({
      tracked: true,
      row: { lastViewedSessionSeq: 3, unreadSince: 1_700 },
      visibleSessionSeq: 9,
    })).toEqual({ state: 'tracking', lastViewedSessionSeq: 3, unreadSince: 1_700 });
  });

  it('produces values the strict wire schema accepts', () => {
    const projected = projectViewerReadStateV1({
      tracked: true,
      row: { lastViewedSessionSeq: 3, unreadSince: 1_700 },
      visibleSessionSeq: 9,
    });
    expect(ViewerReadStateV1Schema.safeParse(projected).success).toBe(true);
    expect(ViewerReadStateV1Schema.safeParse(NOT_STARTED_VIEWER_READ_STATE_V1).success).toBe(true);
  });

  it('rejects a smuggled unread boolean on the wire', () => {
    expect(ViewerReadStateV1Schema.safeParse({
      state: 'tracking',
      lastViewedSessionSeq: 3,
      unreadSince: null,
      unread: true,
    }).success).toBe(false);
  });
});

describe('projectLegacyViewerLastViewedSessionSeqV1', () => {
  it('projects the visible ceiling for an untracked accessible viewer so old readers stay quiet', () => {
    expect(projectLegacyViewerLastViewedSessionSeqV1({
      readState: NOT_STARTED_VIEWER_READ_STATE_V1,
      visibleSessionSeq: 9,
    })).toBe(9);
  });

  it('projects the tracked frontier unchanged', () => {
    expect(projectLegacyViewerLastViewedSessionSeqV1({
      readState: { state: 'tracking', lastViewedSessionSeq: 4, unreadSince: null },
      visibleSessionSeq: 9,
    })).toBe(4);
  });
});

describe('projectLegacyViewerUnreadSinceV1', () => {
  it('never discloses an unread-entry instant to an untracked viewer', () => {
    expect(projectLegacyViewerUnreadSinceV1(NOT_STARTED_VIEWER_READ_STATE_V1)).toBeNull();
  });

  it('projects the tracked viewer instant', () => {
    expect(projectLegacyViewerUnreadSinceV1({
      state: 'tracking',
      lastViewedSessionSeq: 4,
      unreadSince: 1_700,
    })).toBe(1_700);
  });
});

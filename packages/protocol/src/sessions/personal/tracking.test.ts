import { describe, expect, it } from 'vitest';

import { isSessionPersonallyTrackedV1 } from './tracking.js';

const OWNER = 'account-owner';
const COLLABORATOR = 'account-collaborator';

describe('isSessionPersonallyTrackedV1', () => {
  it('tracks the Session owner without any Follow row', () => {
    expect(isSessionPersonallyTrackedV1({
      ownerAccountId: OWNER,
      viewerAccountId: OWNER,
      followFacts: null,
    })).toBe(true);
  });

  it('tracks a non-owner only while Follow is active', () => {
    expect(isSessionPersonallyTrackedV1({
      ownerAccountId: OWNER,
      viewerAccountId: COLLABORATOR,
      followFacts: { follows: true, notificationLevel: 'none' },
    })).toBe(true);
  });

  it('does not track an explicitly unfollowed collaborator', () => {
    expect(isSessionPersonallyTrackedV1({
      ownerAccountId: OWNER,
      viewerAccountId: COLLABORATOR,
      followFacts: { follows: false, notificationLevel: 'none' },
    })).toBe(false);
  });

  it('does not track a collaborator with no Follow row', () => {
    expect(isSessionPersonallyTrackedV1({
      ownerAccountId: OWNER,
      viewerAccountId: COLLABORATOR,
      followFacts: { follows: false, notificationLevel: null },
    })).toBe(false);
  });

  it('fails quietly for malformed Follow facts instead of inferring ownership', () => {
    expect(isSessionPersonallyTrackedV1({
      ownerAccountId: OWNER,
      viewerAccountId: COLLABORATOR,
      followFacts: { follows: 'yes' } as unknown as { follows: boolean; notificationLevel: null },
    })).toBe(false);
  });
});

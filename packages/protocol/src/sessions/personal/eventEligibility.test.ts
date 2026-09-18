import { describe, expect, it } from 'vitest';

import {
  type SessionPersonalEventEligibilityInputV1,
  resolveSessionEffectiveNotificationV1,
  resolveSessionPersonalEventEligibilityV1,
} from './eventEligibility.js';

const TEAM_READER: SessionPersonalEventEligibilityInputV1 = {
  event: 'ready',
  isSessionOwner: false,
  accessible: true,
  accountSuspended: false,
  archived: false,
  responsible: false,
  tracked: false,
  targeted: false,
  followFacts: { follows: false, notificationLevel: null },
  capabilities: { canSubmitAgentInput: false, canApprovePermissions: false },
};

describe('resolveSessionEffectiveNotificationV1', () => {
  it('keeps the owner Important default without a stored preference', () => {
    expect(resolveSessionEffectiveNotificationV1({
      facts: { follows: false, notificationLevel: null },
      isSessionOwner: true,
    })).toEqual({ level: 'important', source: 'owner' });
  });

  it('lets an explicit preference win over the owner default', () => {
    expect(resolveSessionEffectiveNotificationV1({
      facts: { follows: true, notificationLevel: 'all_messages' },
      isSessionOwner: true,
    })).toEqual({ level: 'all_messages', source: 'preference' });
  });

  it('reports explicit suppression as a preference, not absence', () => {
    expect(resolveSessionEffectiveNotificationV1({
      facts: { follows: false, notificationLevel: 'none' },
      isSessionOwner: false,
    })).toEqual({ level: 'none', source: 'preference' });
  });

  it('gives a non-owner without a Follow row nothing', () => {
    expect(resolveSessionEffectiveNotificationV1({
      facts: { follows: false, notificationLevel: null },
      isSessionOwner: false,
    })).toEqual({ level: 'none', source: 'none' });
  });
});

describe('resolveSessionPersonalEventEligibilityV1', () => {
  it('never admits a Team reader on access alone', () => {
    for (const event of ['ready', 'failed', 'message', 'human_message'] as const) {
      expect(resolveSessionPersonalEventEligibilityV1({ ...TEAM_READER, event }))
        .toEqual({ eligible: false });
    }
  });

  it('admits a targeted assignment alert only through effective Follow notification', () => {
    expect(resolveSessionPersonalEventEligibilityV1({
      ...TEAM_READER,
      event: 'assigned',
      targeted: true,
      responsible: true,
      tracked: true,
      followFacts: { follows: true, notificationLevel: 'important' },
    })).toEqual({ eligible: true, reason: 'assignment_target' });
    expect(resolveSessionPersonalEventEligibilityV1({
      ...TEAM_READER,
      event: 'assigned',
      targeted: true,
      responsible: true,
    })).toEqual({ eligible: false });
    expect(resolveSessionPersonalEventEligibilityV1({
      ...TEAM_READER,
      event: 'assigned',
      targeted: true,
      responsible: true,
      tracked: true,
      followFacts: { follows: true, notificationLevel: 'none' },
    })).toEqual({ eligible: false });
  });

  it('admits one targeted direct-share fact without tracking', () => {
    expect(resolveSessionPersonalEventEligibilityV1({
      ...TEAM_READER,
      event: 'directly_shared',
      targeted: true,
    })).toEqual({ eligible: true, reason: 'direct_share_target' });
  });

  it('admits a targeted discussion mention without creating a subscription', () => {
    expect(resolveSessionPersonalEventEligibilityV1({
      ...TEAM_READER,
      event: 'discussion_mention',
      targeted: true,
    })).toEqual({ eligible: true, reason: 'discussion_mention_target' });
  });

  it('rejects an untargeted mention event', () => {
    expect(resolveSessionPersonalEventEligibilityV1({
      ...TEAM_READER,
      event: 'discussion_mention',
      targeted: false,
    })).toEqual({ eligible: false });
  });

  it('keeps the owner Important default for ready and failed events', () => {
    expect(resolveSessionPersonalEventEligibilityV1({
      ...TEAM_READER,
      event: 'failed',
      isSessionOwner: true,
      tracked: true,
    })).toEqual({ eligible: true, reason: 'owner_important' });
  });

  it('admits Important Follow for ready but not for an ordinary message', () => {
    const important: SessionPersonalEventEligibilityInputV1 = {
      ...TEAM_READER,
      tracked: true,
      followFacts: { follows: true, notificationLevel: 'important' },
    };
    expect(resolveSessionPersonalEventEligibilityV1(important))
      .toEqual({ eligible: true, reason: 'follow_important' });
    expect(resolveSessionPersonalEventEligibilityV1({ ...important, event: 'message' }))
      .toEqual({ eligible: false });
    expect(resolveSessionPersonalEventEligibilityV1({ ...important, event: 'human_message' }))
      .toEqual({ eligible: true, reason: 'follow_important' });
  });

  it('admits every permitted material message only at all_messages', () => {
    expect(resolveSessionPersonalEventEligibilityV1({
      ...TEAM_READER,
      event: 'message',
      tracked: true,
      followFacts: { follows: true, notificationLevel: 'all_messages' },
    })).toEqual({ eligible: true, reason: 'follow_all_messages' });
  });

  it('keeps a following collaborator with notifications off out of every ongoing event', () => {
    expect(resolveSessionPersonalEventEligibilityV1({
      ...TEAM_READER,
      tracked: true,
      followFacts: { follows: true, notificationLevel: 'none' },
    })).toEqual({ eligible: false });
  });

  it('does not let responsibility bypass an explicit Unfollow', () => {
    expect(resolveSessionPersonalEventEligibilityV1({
      ...TEAM_READER,
      responsible: true,
      tracked: false,
      followFacts: { follows: false, notificationLevel: 'none' },
    })).toEqual({ eligible: false });
  });

  it('admits a targeted capable action request without ongoing tracking', () => {
    expect(resolveSessionPersonalEventEligibilityV1({
      ...TEAM_READER,
      event: 'permission_required',
      targeted: true,
      capabilities: { canSubmitAgentInput: false, canApprovePermissions: true },
    })).toEqual({ eligible: true, reason: 'targeted_capable_action' });
  });

  it('never broadcasts an action request to a capable but untargeted, unfollowed reader', () => {
    expect(resolveSessionPersonalEventEligibilityV1({
      ...TEAM_READER,
      event: 'user_action_required',
      capabilities: { canSubmitAgentInput: true, canApprovePermissions: true },
    })).toEqual({ eligible: false });
  });

  it('drops an action request when the Account can no longer perform it', () => {
    expect(resolveSessionPersonalEventEligibilityV1({
      ...TEAM_READER,
      event: 'user_action_required',
      tracked: true,
      followFacts: { follows: true, notificationLevel: 'important' },
      capabilities: { canSubmitAgentInput: false, canApprovePermissions: false },
    })).toEqual({ eligible: false });
  });

  it('stops every event on lost access, suspension, and archive', () => {
    const owner: SessionPersonalEventEligibilityInputV1 = {
      ...TEAM_READER,
      isSessionOwner: true,
      tracked: true,
    };
    expect(resolveSessionPersonalEventEligibilityV1({ ...owner, accessible: false }))
      .toEqual({ eligible: false });
    expect(resolveSessionPersonalEventEligibilityV1({ ...owner, accountSuspended: true }))
      .toEqual({ eligible: false });
    expect(resolveSessionPersonalEventEligibilityV1({ ...owner, archived: true }))
      .toEqual({ eligible: false });
  });
});

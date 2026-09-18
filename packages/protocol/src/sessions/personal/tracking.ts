import type { SessionFollowFactsV1 } from '../follow/accountFollow.js';

/**
 * The one tracking predicate (L09B-R15): a Session owner, or a non-owner while
 * Follow is active. Retained cursor presence, list relevance, responsibility,
 * attention standing and notification level are deliberately NOT authority —
 * each of them was previously enough to enroll somebody in another Account's
 * unread state.
 *
 * `following=true, notificationLevel='none'` still tracks unread; explicit
 * Unfollow does not. Current access, Account status and archive are separate
 * questions answered by the attention/eligibility owners.
 */
export function isSessionPersonallyTrackedV1(params: Readonly<{
  ownerAccountId: string;
  viewerAccountId: string;
  followFacts: SessionFollowFactsV1 | null | undefined;
}>): boolean {
  return isSessionPersonallyTrackedForViewerV1({
    isSessionOwner: params.ownerAccountId === params.viewerAccountId,
    followFacts: params.followFacts,
  });
}

/**
 * The same decision for a caller that already holds the resolved ownership fact
 * rather than both Account ids — the client editor, which is told whether the
 * authenticated Account owns the Session and never sees another Account's id.
 */
export function isSessionPersonallyTrackedForViewerV1(params: Readonly<{
  isSessionOwner: boolean;
  followFacts: SessionFollowFactsV1 | null | undefined;
}>): boolean {
  if (params.isSessionOwner) return true;
  return params.followFacts?.follows === true;
}

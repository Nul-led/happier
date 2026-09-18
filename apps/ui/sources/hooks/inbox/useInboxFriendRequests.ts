import * as React from 'react';

import { useFriendsEnabled } from '@/hooks/server/useFriendsEnabled';
import { useFriendsIdentityReadiness } from '@/hooks/server/useFriendsIdentityReadiness';
import { useFriendRequests } from '@/sync/domains/state/storage';

type InboxFriendRequests = Readonly<{
    /** Whether the Inbox screen renders the friends section at all. */
    visible: boolean;
    requests: ReturnType<typeof useFriendRequests>;
}>;

/** Stable identity so a gated-off surface never re-renders its consumers. */
const NO_FRIEND_REQUESTS: ReturnType<typeof useFriendRequests> = [];

/**
 * The one decision for whether incoming friend requests are Inbox content.
 *
 * The navigation dot and the Inbox screen read the same gate. Reading the raw
 * request list in the dot while the screen gated it behind the friends surface
 * left a request that no screen can show lighting a dot the user cannot clear.
 */
export function useInboxFriendRequests(): InboxFriendRequests {
    const friendsEnabled = useFriendsEnabled();
    const identityReadiness = useFriendsIdentityReadiness();
    const requests = useFriendRequests();
    const visible = friendsEnabled && identityReadiness.isReady;

    return React.useMemo(
        () => ({ visible, requests: visible ? requests : NO_FRIEND_REQUESTS }),
        [requests, visible],
    );
}

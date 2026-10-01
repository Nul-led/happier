import type { SessionPersonalEventEphemeralV1 } from '@happier-dev/protocol/updates';

import { publishPresentationNotice } from '@/components/sessions/presentation/presentationNotices';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import { t } from '@/text';

/** Live recipient facts share the app's transient notice host, not its OS-alert bus. */
export function presentSessionPersonalEvent(
    address: SessionAddress,
    event: SessionPersonalEventEphemeralV1,
): void {
    if (event.event !== 'directly_shared' && event.event !== 'assigned') return;
    publishPresentationNotice({
        key: JSON.stringify([address.serverId, address.sessionId, event.eventId]),
        severity: 'info',
        message: event.event === 'directly_shared'
            ? t('session.follow.sharedNotice')
            : event.assignmentAutoFollowed
                ? t('session.follow.assignedExplanation')
                : t('session.follow.assignedNotice'),
    });
}

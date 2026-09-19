import { t } from '@/text';
import { formatAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
import type { SessionHumanPresenceViewer } from '@/sync/domains/session/humanPresence/sessionHumanPresenceStore';

/**
 * The one way presence names a viewer, for every surface that reads them aloud.
 *
 * Typing is signalled visually by the avatar ring, which is a colour difference a
 * screen reader cannot read and a colour-blind viewer cannot see. The same fact
 * therefore has to reach the accessible name, and it must say it the same way in
 * the header facepile and in the Viewing-now section — one owner, so the two can
 * never disagree about who is typing.
 *
 * Retained last-known presence carries no typing claim: `typing` is a live fact,
 * and repeating a stale one would be a quieter untruth than dropping it.
 */
export function formatSessionPresenceViewerNames(
    viewers: readonly SessionHumanPresenceViewer[],
    options?: Readonly<{ stale?: boolean }>,
): string {
    return viewers.map((viewer) => {
        const name = formatAccountDisplayName(viewer.account) ?? t('session.collaboration.unnamed');
        return options?.stale !== true && viewer.typing
            ? `${name} · ${t('session.collaboration.typing')}`
            : name;
    }).join(', ');
}

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

/** "Ana is here", "Ana and Ben are here", "Ana and 3 others are here". */
export function formatSessionPresenceHere(viewers: readonly SessionHumanPresenceViewer[]): string {
    const name = (viewer: SessionHumanPresenceViewer) => formatAccountDisplayName(viewer.account) ?? t('session.collaboration.unnamed');
    const [first, second] = viewers;
    if (!first) return t('session.collaboration.pane.justYouHere');
    if (!second) return t('session.collaboration.pane.hereOne', { name: name(first) });
    if (viewers.length === 2) return t('session.collaboration.pane.hereTwo', { first: name(first), second: name(second) });
    return t('session.collaboration.pane.hereMany', { first: name(first), count: viewers.length - 1 });
}

/** The live second line: who is typing, if anyone. Retained presence carries no typing claim. */
export function formatSessionPresenceTyping(viewers: readonly SessionHumanPresenceViewer[]): string | null {
    const typing = viewers.filter((viewer) => viewer.typing);
    const [only] = typing;
    if (!only) return null;
    if (typing.length === 1) {
        return t('session.collaboration.pane.typingOne', { name: formatAccountDisplayName(only.account) ?? t('session.collaboration.unnamed') });
    }
    return t('session.collaboration.pane.typingMany', { count: typing.length });
}

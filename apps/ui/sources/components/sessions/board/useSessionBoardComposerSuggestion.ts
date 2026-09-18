import * as React from 'react';

import {
    readSessionComposerPresentationTargetAtAddress,
    requestRegisteredSessionComposerFocus,
    subscribeSessionComposerPresentationTargets,
} from '@/components/sessions/presentation/sessionComposerPresentationTargets';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import { t } from '@/text';

/**
 * The empty Board's **Ask the agent** orientation action.
 *
 * The Board never sends anything. It puts one editable localized sentence into
 * the Session's own composer and hands the person the caret, exactly as the
 * approved journey describes: an invitation to finish a prompt, not a silent
 * submission and not a second message path.
 *
 * Everything here goes through the incumbent composer presentation owner — the
 * same registry the daemon's current-UI commands use — and through its EXACT
 * Home/Session registration, because two Homes can hold the same raw Session id
 * and a viewer-local effect must never land in the other one. No draft store,
 * suggestion queue or composer bridge is added.
 */

/**
 * Compose the next composer text.
 *
 * Returns `null` when the suggestion is already present, so pressing the action
 * twice focuses the composer instead of stacking duplicate sentences. An
 * existing draft is preserved and the suggestion is appended after it: this
 * action offers words, it never takes any away.
 */
export function appendSessionBoardComposerSuggestion(
    currentText: string,
    suggestion: string,
): string | null {
    if (currentText.includes(suggestion)) return null;
    const retained = currentText.replace(/\s+$/u, '');
    return retained.length === 0 ? suggestion : `${retained}\n\n${suggestion}`;
}

/**
 * `null` while no mounted composer of this exact Home/Session can receive the
 * suggestion, so the Add row omits the control rather than drawing one that does
 * nothing when pressed.
 */
export function useSessionBoardComposerSuggestion(address: SessionAddress): (() => void) | null {
    // Availability is deliberately the cheapest fact that decides it: whether an
    // exact-address target is registered and current. This runs on every composer
    // notification in the app, so it must not build a document snapshot; the text
    // is read once, at press time, from the same target.
    const readAvailability = React.useCallback(
        () => readSessionComposerPresentationTargetAtAddress(address) !== null,
        [address],
    );
    const available = React.useSyncExternalStore(
        subscribeSessionComposerPresentationTargets,
        readAvailability,
        readAvailability,
    );

    const suggest = React.useCallback(() => {
        const target = readSessionComposerPresentationTargetAtAddress(address);
        if (!target) return;
        const snapshot = target.readSnapshot?.();
        // A composer the person cannot currently edit — a running turn's input
        // lock — keeps its own truthful state. Never write behind that lock.
        if (snapshot && snapshot.state.editable !== false) {
            const next = appendSessionBoardComposerSuggestion(
                snapshot.text,
                t('sessionBoard.empty.editor.askAgentPrompt'),
            );
            // The text is committed before focus so the caret lands after the
            // invitation rather than in the middle of the document it replaced.
            if (next !== null) target.replace(next, snapshot.revision);
        }
        requestRegisteredSessionComposerFocus(address);
    }, [address]);

    return available ? suggest : null;
}

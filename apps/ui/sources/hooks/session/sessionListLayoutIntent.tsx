import * as React from 'react';

import { useSetting } from '@/sync/domains/state/storage';
import {
    normalizeSessionListSectionModeV1,
    resolveSessionListLayoutChoice,
    type SessionListLayoutChoice,
} from '@/sync/domains/session/listing/sessionListLayout';

const SessionListLayoutIntentContext = React.createContext<SessionListLayoutChoice | null>(null);

/**
 * Declares a presentation-only layout for one hosted visit.
 *
 * Compatibility routes such as `/session/recent` open the canonical Sessions list in
 * a specific arrangement without becoming a second list, a route-specific layout
 * field, or a writer of the Account preference. The intent lives exactly as long as
 * the host stays mounted, so Back restores the stored layout with no settings
 * request and no cross-device change.
 */
export function SessionListLayoutIntentProvider(props: Readonly<{
    choice: SessionListLayoutChoice;
    children: React.ReactNode;
}>) {
    return (
        <SessionListLayoutIntentContext.Provider value={props.choice}>
            {props.children}
        </SessionListLayoutIntentContext.Provider>
    );
}

export function useSessionListLayoutIntent(): SessionListLayoutChoice | null {
    return React.useContext(SessionListLayoutIntentContext);
}

/**
 * The one reader of the effective Session-list layout.
 *
 * Every surface that arranges the list — the index builder, the shell chrome and the
 * drag/reorder policy — resolves the same choice here so a host intent and the stored
 * preference cannot disagree between them.
 */
export function useSessionListLayoutChoice(): SessionListLayoutChoice {
    const sessionListSectionModeV1 = normalizeSessionListSectionModeV1(useSetting('sessionListSectionModeV1'));
    const sessionListActiveGroupingV1 = useSetting('sessionListActiveGroupingV1');
    const transientIntent = useSessionListLayoutIntent();
    return resolveSessionListLayoutChoice({
        sessionListSectionModeV1,
        sessionListActiveGroupingV1,
    }, transientIntent);
}

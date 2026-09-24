import * as React from 'react';

import { useSessionCompanionPreferenceSlot } from '@/sync/domains/state/storage';

import {
    normalizeSessionCompanionPreference,
    type SessionCompanionPreferenceV1,
} from './sessionCompanionPreference';

export type SessionCompanionAvailability = 'ready' | 'realm_unavailable';

/**
 * The narrow read half of the viewer-local Companion preference.
 *
 * Placement, the primary-mount owner and the header control need the current
 * preference without the mutation surface, and none of them should hold a
 * navigation callback just to read it.
 */
export function useSessionCompanionPreference(input: Readonly<{
    sessionId: string | null;
    serverId?: string | null;
}>): Readonly<{
    preference: SessionCompanionPreferenceV1;
    availability: SessionCompanionAvailability;
    preferenceExists: boolean;
    /**
     * The realm-qualified storage key this preference currently resolves to — the exact
     * Account+Home+Session identity the canonical key owner produced. Consumers compare it
     * rather than re-deriving a realm of their own.
     */
    realmKey: string | null;
}> {
    const slot = useSessionCompanionPreferenceSlot(input.sessionId, input.serverId ?? null);
    const preference = React.useMemo(
        () => normalizeSessionCompanionPreference(slot.stored),
        [slot.stored],
    );
    return React.useMemo(() => Object.freeze({
        preference,
        availability: slot.storageKey ? 'ready' as const : 'realm_unavailable' as const,
        preferenceExists: slot.stored !== undefined,
        realmKey: slot.storageKey,
    }), [preference, slot.storageKey, slot.stored]);
}

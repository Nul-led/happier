import * as React from 'react';
import { resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';
import { sessionHumanPresenceStore, type SessionHumanPresenceTarget, type SessionHumanPresenceView } from './sessionHumanPresenceStore';

const unavailablePresence: SessionHumanPresenceView = Object.freeze({
    status: 'unavailable', viewers: Object.freeze([]), observedAt: null,
});

export function useSessionHumanPresence(input: SessionHumanPresenceTarget | null): SessionHumanPresenceView {
    const serverIdentifier = input?.serverId ?? '';
    const sessionId = input?.sessionId ?? '';
    const discussionId = input?.discussionId;
    const hasTarget = input !== null;
    const serverId = resolveServerProfileScopeIdForIdentifier(serverIdentifier) || serverIdentifier;
    const target = React.useMemo<SessionHumanPresenceTarget | null>(() => hasTarget
        ? { serverId, sessionId, ...(discussionId ? { discussionId } : {}) }
        : null, [discussionId, hasTarget, serverId, sessionId]);
    const subscribe = React.useCallback((listener: () => void) => target
        ? sessionHumanPresenceStore.subscribe(target, listener)
        : () => {}, [target]);
    const read = React.useCallback(() => target ? sessionHumanPresenceStore.read(target) : unavailablePresence, [target]);
    return React.useSyncExternalStore(subscribe, read, read);
}

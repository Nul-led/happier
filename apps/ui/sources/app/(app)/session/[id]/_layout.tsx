import * as React from 'react';
import { Slot, useLocalSearchParams, useRouter } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';

import { SessionInvalidLinkFallback } from '@/components/sessions/shell/SessionInvalidLinkFallback';
import { normalizeSessionId } from '@/sync/domains/session/normalizeSessionId';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';
import { storage, useSession } from '@/sync/domains/state/storage';
import { isVoiceTranscriptHistorySession } from '@/voice/persistence/voiceTranscriptHistorySession';
import { createSessionRouteServerScope, readSessionRouteServerId } from '@/hooks/session/sessionRouteServerScope';
import { useActiveRetainedSessionListQueryStates } from '@/components/sessions/shell/sessionListPaneRetention';

export default function OrdinarySessionRouteLayout() {
    const router = useRouter();
    const params = useLocalSearchParams<{ id?: string | string[]; serverId?: string | string[] }>();
    const sessionId = normalizeSessionId(params.id);
    const queryStates = useActiveRetainedSessionListQueryStates();
    const candidateServerIds = storage(useShallow((state) => createSessionRouteServerScope(params, state, { queryStates })
        .candidateAddresses.map((address) => address.serverId)));
    const session = useSession(sessionId);
    const explicitServerId = readSessionRouteServerId(params);
    const promotedServerId = explicitServerId === null && candidateServerIds.length === 1
        ? candidateServerIds[0]
        : null;
    React.useEffect(() => {
        if (promotedServerId) {
            router.setParams({ serverId: promotedServerId });
        }
    }, [promotedServerId, router]);
    const isVoiceTranscriptHistory = isVoiceTranscriptHistorySession(session && (!explicitServerId || session.serverId === explicitServerId)
        ? {
            active: session.active,
            metadata: readSessionOwnerMetadataView(session),
        }
        : null);

    // The nested route reconstructs its hydration scope from route params. Do not
    // mount it while the sole authoritative legacy candidate is still unqualified.
    if (promotedServerId) {
        return null;
    }

    // Keep the children unmounted: an ambiguous legacy link must not start route hydration.
    if (candidateServerIds.length > 1) {
        return <SessionInvalidLinkFallback sessionId={sessionId} candidateServerIds={candidateServerIds} />;
    }

    // A bare link no Home is known to hold resolves only through its origin or one
    // known address (Lane 07.1); the focused Home never answers it by default. The
    // person picks the Home instead, and that choice opens the exact qualified route.
    if (explicitServerId === null && candidateServerIds.length === 0) {
        return <SessionInvalidLinkFallback sessionId={sessionId} homeChoice="unknown" />;
    }

    if (isVoiceTranscriptHistory) {
        return <SessionInvalidLinkFallback />;
    }

    return <Slot />;
}

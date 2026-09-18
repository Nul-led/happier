import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';

import { TokenStorage } from '@/auth/storage/tokenStorage';
import {
    resolveSessionAttentionReminderDeadline,
    type SessionAttentionReminderDeadline,
    useSessionAttentionReminderRefresh,
} from '@/activity/attention/runtime/sessionAttentionReminderScheduler';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import {
    listServerProfiles,
    resolveServerProfileScopeId,
} from '@/sync/domains/server/serverProfiles';
import { type SessionAddress } from '@/sync/domains/session/sessionAddress';
import { createSessionListOrganizationSnapshotRequest } from '@/sync/engine/sessions/sessionListOrganizationSnapshotRequest';
import { invalidateSessionListQueryHome } from '@/sync/domains/session/listing/sessionListQueryInvalidation';
import { storage } from '@/sync/domains/state/storage';
import { fetchAndApplySessionOrganizationSnapshot } from '@/sync/ops/sessionOrganization';
import { sync } from '@/sync/sync';
import { useSessionOrganizationProjections, useSocketStatus } from '@/sync/store/hooks';

export async function refreshSessionAttentionReminderInventory(params: Readonly<{
    serverId: string;
    serverUrl: string;
}>): Promise<void> {
    const credentials = await TokenStorage.getCredentialsForServerUrl(params.serverUrl, { serverId: params.serverId });
    if (!credentials) return;
    await fetchAndApplySessionOrganizationSnapshot({
        credentials,
        serverId: params.serverId,
        serverUrl: params.serverUrl,
        request: createSessionListOrganizationSnapshotRequest(),
    });
}

export function SessionAttentionReminderRuntime(): React.ReactElement | null {
    const activeServer = useActiveServerSnapshot();
    const activeServerId = activeServer.serverId.trim();
    const serverProfilesGeneration = useServerProfilesGeneration();
    const activeSocket = useSocketStatus();
    const serverProfiles = React.useMemo(() => listServerProfiles(), [serverProfilesGeneration]);
    const serverProfilesByScopeId = React.useMemo(() => new Map(
        serverProfiles.map((profile) => [resolveServerProfileScopeId(profile), profile] as const),
    ), [serverProfiles]);
    const serverIds = React.useMemo(() => [...new Set([
        ...serverProfiles.map((profile) => resolveServerProfileScopeId(profile)).filter(Boolean),
        ...(activeServerId ? [activeServerId] : []),
    ])].sort(), [activeServerId, serverProfiles]);
    const organizationByServerId = useSessionOrganizationProjections(serverIds);
    const secondaryConnectedByServerId = storage(useShallow(React.useCallback((state) => (
        Object.fromEntries(serverIds.map((serverId) => [
            serverId,
            state.concurrentSessionListCacheByServerId?.[serverId]?.listObservation?.phase === 'ready',
        ]))
    ), [serverIds])));

    const connectedByServerId = React.useMemo(() => ({
        ...secondaryConnectedByServerId,
        ...(activeServerId
            ? { [activeServerId]: activeSocket.status === 'connected' }
            : {}),
    }), [activeServerId, activeSocket.status, secondaryConnectedByServerId]);
    const reminders = React.useMemo(() => Object.entries(organizationByServerId).flatMap(
        ([serverId, organization]) => Object.values(organization.attentionStandingsBySessionId).flatMap((standing) => {
            const reminder = resolveSessionAttentionReminderDeadline(serverId, standing);
            return reminder ? [reminder] : [];
        }),
    ), [organizationByServerId]);
    const refreshSession = React.useCallback(async (address: SessionAddress) => {
        await sync.ensureSessionVisibleForMessageRoute(address.sessionId, {
            serverId: address.serverId,
            forceRefresh: true,
        });
    }, []);
    const refreshReminderInventory = React.useCallback(async (serverId: string) => {
        const profile = serverProfilesByScopeId.get(serverId);
        const serverUrl = profile?.serverUrl
            ?? (activeServerId === serverId ? activeServer.serverUrl : null);
        if (!serverUrl) return;
        await refreshSessionAttentionReminderInventory({ serverId, serverUrl });
    }, [activeServer.serverUrl, activeServerId, serverProfilesByScopeId]);

    useSessionAttentionReminderRefresh({
        connectedByServerId,
        invalidateSessionListQueryHome,
        refreshReminderInventory,
        refreshSession,
        reminders,
    });
    return null;
}

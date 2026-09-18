import * as React from 'react';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { sessionFollowGet, sessionFollowRemove, sessionFollowSet } from '@/sync/api/session/sessionFollowApi';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { subscribeHomeCredentialMutations } from '@/auth/storage/tokenStorage';
import { subscribeHomeAccountChange } from '@/sync/runtime/orchestration/homeAccountChange';
import {
    isServerReachabilityNetworkAllowed,
    subscribeServerReachabilityNetworkAllowed,
} from '@/sync/runtime/connectivity/serverReachabilitySupervisorPool';

import { AccountSessionFollowEditor } from './AccountSessionFollowEditor';
import { createAccountSessionFollowController } from './accountSessionFollowController';
import { useAccountVoiceFollowReadiness } from './useAccountVoiceFollowReadiness';

export function AccountSessionFollowControl(props: Readonly<{
    address: SessionAddress;
    archived?: boolean;
    onClose?: () => void;
    onOpenNotificationSettings?: () => void;
}>) {
    const enabled = useFeatureEnabled('sessions.following', { scopeKind: 'spawn', serverId: props.address.serverId });
    const { serverId, sessionId } = props.address;
    const controller = React.useMemo(() => createAccountSessionFollowController({ serverId, sessionId }, {
        get: sessionFollowGet,
        set: sessionFollowSet,
        remove: sessionFollowRemove,
    }), [serverId, sessionId]);
    const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    const voiceReadiness = useAccountVoiceFollowReadiness({
        sessionId,
        serverId,
        initialSnapshotPending: state.voiceInitialSnapshotPending,
    });
    const onCloseRef = React.useRef(props.onClose);
    onCloseRef.current = props.onClose;

    React.useEffect(() => {
        if (!enabled) return;
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (!lifetime?.isCurrent()) return;
        const retire = () => { controller.dispose(); onCloseRef.current?.(); };
        const retirement = lifetime.onRetire(retire);
        const credentials = subscribeHomeCredentialMutations((event) => {
            if (areServerProfileIdentifiersEquivalent(event.serverId, serverId)) retire();
        });
        controller.setOnline(isServerReachabilityNetworkAllowed());
        const connectivity = subscribeServerReachabilityNetworkAllowed((online) => {
            const wasOffline = !controller.getSnapshot().online;
            controller.setOnline(online);
            if (online && wasOffline) void controller.refresh();
        });
        const changes = subscribeHomeAccountChange((event) => {
            if (areServerProfileIdentifiersEquivalent(event.serverId, serverId)) void controller.refresh();
        });
        void controller.refresh();
        return () => { retirement.dispose(); credentials(); connectivity(); changes(); };
    }, [controller, enabled, serverId]);

    if (!enabled) return null;
    return <AccountSessionFollowEditor
        state={state}
        voiceReadiness={voiceReadiness}
        archived={props.archived === true}
        onSet={(preferences) => { void controller.set(preferences); }}
        onRemove={() => { void controller.remove(); }}
        onRetry={() => { void controller.retry(); }}
        onOpenNotificationSettings={() => { props.onOpenNotificationSettings?.(); }}
    />;
}

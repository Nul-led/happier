import * as React from 'react';
import { isSessionAwarenessContentReadableV1 } from '@happier-dev/protocol';
import { projectUiSessionAwareness } from '@/sync/domains/session/awareness/sessionAwareness';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useRouter } from 'expo-router';

import type { Session } from '@/sync/domains/state/storageTypes';
import type { PendingPermissionRequest } from '@/utils/sessions/sessionUtils';

import { useMachine, useServerScopedMachine } from '@/sync/domains/state/storage';
import { readDisplayMachineIdForSession } from '@/sync/ops/sessionMachineTarget';
import { PermissionPromptCard } from '@/components/tools/shell/permissions/PermissionPromptCard';
import { UserActionPromptCard } from '@/components/tools/shell/userActions/UserActionPromptCard';
import { deriveTranscriptInteractionFromSession } from '@/utils/sessions/deriveTranscriptInteraction';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import { createActivitySurfaceSessionRoute } from '@/activity/actions/activitySurfaceTargets';
import { InboxSessionAttentionHeader } from './InboxSessionAttentionHeader';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';
import { t } from '@/text';
import type { SessionListIdentityDisplay } from '@/components/sessions/shell/SessionListIdentity';

export const InboxSessionAttentionGroupCard = React.memo(function InboxSessionAttentionGroupCard(props: Readonly<{
    session: Session;
    serverId: string | null;
    identityDisplay: SessionListIdentityDisplay;
    connected: boolean;
    contextLine?: string | null;
    permissionRequests: readonly PendingPermissionRequest[];
    userActionRequests: readonly PendingPermissionRequest[];
    showDivider?: boolean;
    onBeforeNavigate?: () => void;
}>) {
    const router = useRouter();
    const statusOnly = props.session.viewer?.attention.presentation === 'status_only'
        || !isSessionAwarenessContentReadableV1(projectUiSessionAwareness(props.session, Date.now()).encryption);
    const ownerMetadata = statusOnly ? null : readSessionOwnerMetadataView(props.session);
    const machineId = statusOnly ? '' : readDisplayMachineIdForSession({
        // Qualified cards already carry their exact Home metadata. A bare-id store lookup
        // could substitute the active Home's same-id Session.
        sessionId: props.serverId ? null : props.session.id,
        metadata: ownerMetadata,
    });
    const legacyMachine = useMachine(props.serverId ? '' : machineId);
    const scopedMachine = useServerScopedMachine(props.serverId, props.serverId ? machineId : '');
    const machine = props.serverId ? scopedMachine : legacyMachine;
    const transcriptInteraction = React.useMemo(() => {
        return deriveTranscriptInteractionFromSession({
            access: props.session.access,
            active: props.session.active,
            presence: props.session.presence,
        });
    }, [props.session.access, props.session.active, props.session.presence]);
    const openSession = React.useCallback(() => {
        props.onBeforeNavigate?.();
        router.push(createActivitySurfaceSessionRoute(props.session.id, props.serverId));
    }, [props.onBeforeNavigate, props.serverId, props.session.id, router]);

    if (
        transcriptInteraction.permissionDisabledReason === 'inactive' &&
        (props.permissionRequests.length > 0 || props.userActionRequests.length > 0)
    ) {
        return null;
    }

    return (
        <View testID={`inbox.session_attention.${props.session.id}`}>
            <InboxSessionAttentionHeader
                session={props.session}
                serverId={props.serverId}
                identityDisplay={props.identityDisplay}
                connected={props.connected}
                sessionTitle={statusOnly ? t('sessionBoard.item.locked.title') : getSessionName(props.session)}
                machineLabel={statusOnly ? null : getMachineDisplayName(machine)}
                pathLabel={props.contextLine ?? null}
                onOpenSession={openSession}
            />

            <View style={styles.items}>
                {(statusOnly ? [] : props.permissionRequests).map((request) => (
                    <PermissionPromptCard
                        key={request.id}
                        request={request}
                        location={null}
                        sessionId={props.session.id}
                        serverId={props.serverId ?? undefined}
                        metadata={ownerMetadata}
                        canApprovePermissions={transcriptInteraction.canApprovePermissions}
                        disabledReason={transcriptInteraction.permissionDisabledReason}
                    />
                ))}

                {(statusOnly ? [] : props.userActionRequests).map((request) => (
                    <UserActionPromptCard
                        session={props.session}
                        key={request.id}
                        request={request}
                        location={null}
                        sessionId={props.session.id}
                        serverId={props.serverId ?? undefined}
                        metadata={ownerMetadata}
                        canApprovePermissions={transcriptInteraction.canApprovePermissions}
                        disabledReason={transcriptInteraction.permissionDisabledReason}
                    />
                ))}
            </View>
            {props.showDivider ? <View style={styles.divider} /> : null}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    items: {
        gap: 12,
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    divider: {
        height: 1,
        marginLeft: 16,
        backgroundColor: theme.colors.border.default,
    },
}));

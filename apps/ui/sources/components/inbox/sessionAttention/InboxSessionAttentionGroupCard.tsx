import * as React from 'react';
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
import { isInboxSessionStatusOnly, readInboxSessionTitle } from './inboxSessionPrivacy';
import { createActivitySurfaceSessionRoute } from '@/activity/actions/activitySurfaceTargets';
import { InboxSessionAttentionHeader } from './InboxSessionAttentionHeader';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';
import { t } from '@/text';
import { Text } from '@/components/ui/text/Text';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { storage } from '@/sync/domains/state/storage';
import { readMachineControlTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { getPendingQueueWakeResumeOptions } from '@/sync/domains/pending/pendingQueueWake';
import { buildResumeCapabilityOptionsFromUiState } from '@/agents/registry/registryUiBehavior';
import { readAgentScopedPluginSettingsSnapshot } from '@/agents/registry/agentScopedPluginSettings';
import { resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { resumeSession } from '@/sync/ops/sessions';
import type { SessionListIdentityDisplay } from '@/components/sessions/shell/SessionListIdentity';
import { AppSessionTranscriptSourceProvider } from '@/components/sessions/transcript/source/appSessionTranscriptSource';

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
    const statusOnly = isInboxSessionStatusOnly(props.session);
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
    const stoppedWithPendingRequests = !statusOnly && transcriptInteraction.permissionDisabledReason === 'inactive'
        && (props.permissionRequests.length > 0 || props.userActionRequests.length > 0);
    const [resumeFailed, setResumeFailed] = React.useState(false);
    // Returned to `RoundButton`'s `action`, whose shared pending lifecycle marks the
    // control busy and refuses a second press until this settles.
    const resumeStoppedSession = React.useCallback(async () => {
        // A secondary Home's Account settings are not the focused Home's settings.
        // Open its Session so the focused resume owner can use that Home's scope.
        if (props.serverId && getActiveServerSnapshot().serverId !== props.serverId) {
            openSession();
            return;
        }
        setResumeFailed(false);
        try {
            const state = storage.getState();
            const target = readMachineControlTargetForSession(
                props.serverId ? { serverId: props.serverId, sessionId: props.session.id } : props.session.id,
            );
            if (!target) throw new Error('resume_target_unavailable');
            const agentId = resolveAgentIdFromSessionMetadata(ownerMetadata);
            const lifetime = captureActiveServerAccountScopeLifetime();
            const pluginSettings = await readAgentScopedPluginSettingsSnapshot({
                agentId,
                machineId: target?.machineId,
                serverId: props.serverId ?? undefined,
                accountLifetime: lifetime,
                accountSettings: state.settings,
            });
            if (lifetime && !lifetime.isCurrent()) throw new Error('account_changed');
            const options = getPendingQueueWakeResumeOptions({
                sessionId: props.session.id,
                session: props.session,
                resumeCapabilityOptions: buildResumeCapabilityOptionsFromUiState({
                    settings: state.settings,
                    pluginSettings,
                    results: undefined,
                }),
                resumeTargetOverride: { machineId: target.machineId, directory: target.basePath },
            });
            if (!options) throw new Error('resume_unavailable');
            const result = await resumeSession({
                ...options,
                serverId: props.serverId ?? undefined,
                ...(props.serverId ? { preferRequestedMachineTarget: true, preferScopedMachineRpc: true } : {}),
            });
            if (result.type === 'error') throw new Error('resume_failed');
            openSession();
        } catch {
            setResumeFailed(true);
        }
    }, [openSession, ownerMetadata, props.serverId, props.session]);

    return (
        <AppSessionTranscriptSourceProvider sessionId={props.session.id} serverId={props.serverId} interaction={transcriptInteraction}>
        <View testID={`inbox.session_attention.${props.session.id}`}>
            <InboxSessionAttentionHeader
                session={props.session}
                serverId={props.serverId}
                identityDisplay={props.identityDisplay}
                connected={props.connected}
                sessionTitle={readInboxSessionTitle(props.session, props.serverId)}
                machineLabel={statusOnly ? null : getMachineDisplayName(machine)}
                pathLabel={props.contextLine ?? null}
                onOpenSession={openSession}
            />

            <View style={styles.items}>
                {stoppedWithPendingRequests ? (
                    <View testID="inbox.session_attention.stopped" style={styles.stoppedRow}>
                        <Text style={styles.stoppedText}>{t('inbox.stoppedResumeToAnswer')}</Text>
                        <RoundButton
                            testID="inbox.session_attention.resume"
                            size="small"
                            display="secondary"
                            title={t('session.pendingActivation.actions.resume')}
                            accessibilityLabel={t('session.pendingActivation.actions.resume')}
                            action={resumeStoppedSession}
                            style={styles.resumeButton}
                        />
                        {resumeFailed ? <Text testID="inbox.session_attention.resume_error" style={styles.errorText}>{t('session.resumeFailed')}</Text> : null}
                    </View>
                ) : null}
                {(statusOnly || stoppedWithPendingRequests ? [] : props.permissionRequests).map((request) => (
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

                {(statusOnly || stoppedWithPendingRequests ? [] : props.userActionRequests).map((request) => (
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
        </AppSessionTranscriptSourceProvider>
    );
});

const styles = StyleSheet.create((theme) => ({
    items: {
        gap: 12,
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    stoppedRow: { gap: 8, minHeight: 44 },
    stoppedText: { color: theme.colors.text.secondary, fontSize: 14 },
    resumeButton: { alignSelf: 'flex-start' },
    errorText: { color: theme.colors.status.error, fontSize: 14 },
    divider: {
        height: 1,
        marginLeft: 16,
        backgroundColor: theme.colors.border.default,
    },
}));

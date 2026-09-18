import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { InboxSessionAttentionEntry } from '@/activity/presentation/buildInboxSessionPresentation';
import { ApprovalInboxCard } from '@/components/inbox/cards/ApprovalInboxCard';
import { InboxReadySessionRow } from '@/components/inbox/InboxReadySessionRow';
import { InboxSessionAttentionGroupCard } from '@/components/inbox/sessionAttention/InboxSessionAttentionGroupCard';
import { Item } from '@/components/ui/lists/Item';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { UserCard } from '@/components/ui/cards/UserCard';
import { RecoveryKeyReminderBanner } from '@/components/account/RecoveryKeyReminderBanner';
import { Typography } from '@/constants/Typography';
import type { InboxModel } from '@/hooks/inbox/useInboxModel';
import { t } from '@/text';
import { trackFriendsProfileView } from '@/track';
import { sessionAddressKey } from '@/sync/domains/session/sessionAddress';
import { buildServerScopedSessionKey } from '@/sync/domains/session/navigation/sessionNavigationOrder';
import {
    SessionListIdentity,
    useSessionListIdentityDisplay,
} from '@/components/sessions/shell/SessionListIdentity';
import { SESSION_LIST_ROW_IDENTITY_METRICS } from '@/components/sessions/shell/resolveSessionListDensityViewState';

import { ActionOperationRows } from './actionOperations/ActionOperationLedger';
import { openActionOperation } from './actionOperations/actionOperationPresentationRuntime';
import { InboxSection } from './InboxSection';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';

function requiresPromptCard(entry: InboxSessionAttentionEntry): boolean {
    return entry.candidate.personalAttention.reasons.some(
        (reason) => reason === 'permission_required' || reason === 'user_action_required',
    );
}

function buildSessionContextLine(candidate: InboxSessionAttentionEntry['candidate']): string | undefined {
    const status = candidate.personalAttention.reasons.includes('failed')
        ? t('status.error')
        : candidate.attentionState === 'ready'
            ? t('status.readyForReview')
            : getSessionStatus(candidate.session, Date.now(), { workingTextMode: 'static' }).statusText;
    const context = (candidate.context?.contextLine ?? candidate.subtitle).trim();
    return Array.from(new Set([status.trim(), context].filter(Boolean))).join(' · ') || undefined;
}

/**
 * The one non-scrolling Inbox body used by both screen and anchored popover.
 * Each host owns exactly one scroll container and supplies a callback that
 * closes transient chrome before any navigation begins.
 */
export const InboxContent = React.memo(function InboxContent(props: Readonly<{
    model: InboxModel;
    onBeforeNavigate?: () => void;
    presentation?: 'screen' | 'popover';
}>) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const { model } = props;
    const sectionSurface = (props.presentation ?? 'screen') === 'screen' ? 'grouped' : 'flat';
    const identityDisplay = useSessionListIdentityDisplay();
    const nowMs = Date.now();
    const failedSessions = model.sessionPresentation.sessionsNeedingAttention.filter(
        (entry) => entry.candidate.personalAttention.reasons.includes('failed'),
    );
    const actionableSessions = model.sessionPresentation.sessionsNeedingAttention.filter(
        (entry) => !entry.candidate.personalAttention.reasons.includes('failed'),
    );
    const operationGroups = React.useMemo(() => {
        type OperationEntry = InboxModel['actionOperationEntries'][number];
        const failed: OperationEntry[] = [];
        const actionable: OperationEntry[] = [];
        const entryByProjection = new Map<OperationEntry['operation'], OperationEntry>();
        for (const entry of model.actionOperationEntries) {
            (entry.reason === 'failed' ? failed : actionable).push(entry);
            entryByProjection.set(entry.operation, entry);
        }
        return {
            failed,
            actionable,
            failedOperations: failed.map((entry) => entry.operation),
            actionableOperations: actionable.map((entry) => entry.operation),
            entryByProjection,
        };
    }, [model.actionOperationEntries]);

    const navigate = React.useCallback((route: string) => {
        props.onBeforeNavigate?.();
        router.push(route as never);
    }, [props.onBeforeNavigate, router]);
    const openOperation = React.useCallback((operation: Parameters<typeof openActionOperation>[0]) => {
        props.onBeforeNavigate?.();
        openActionOperation(operation);
    }, [props.onBeforeNavigate]);
    const resolveOperation = React.useCallback((operation: Parameters<typeof openActionOperation>[0]) => {
        const entry = operationGroups.entryByProjection.get(operation);
        if (entry) model.resolveActionOperation(entry);
    }, [model, operationGroups.entryByProjection]);

    return (
        <View testID="inbox.content" style={styles.container}>
            <RecoveryKeyReminderBanner />

            {failedSessions.length > 0 || operationGroups.failed.length > 0 ? (
                <InboxSection testID="inbox.section.errors" title={t('inbox.errors')} surface={sectionSurface}>
                    {failedSessions.map((entry) => {
                        const candidate = entry.candidate;
                        if (requiresPromptCard(entry)) {
                            return (
                                <InboxSessionAttentionGroupCard
                                    key={candidate.address ? sessionAddressKey(candidate.address) : candidate.sessionId}
                                    session={candidate.session}
                                    serverId={candidate.address?.serverId ?? candidate.serverId ?? null}
                                    identityDisplay={identityDisplay}
                                    connected={getSessionStatus(candidate.session, nowMs, { workingTextMode: 'static' }).isConnected}
                                    contextLine={candidate.context?.contextLine ?? null}
                                    permissionRequests={entry.pendingPermissions}
                                    userActionRequests={entry.pendingUserActions}
                                    onBeforeNavigate={props.onBeforeNavigate}
                                />
                            );
                        }
                        return (
                            <Item
                                key={candidate.address ? sessionAddressKey(candidate.address) : candidate.sessionId}
                                testID={`inbox.session.${candidate.sessionId}`}
                                title={candidate.title}
                                subtitle={buildSessionContextLine(candidate)}
                                density="compact"
                                leftElement={identityDisplay !== 'none' ? (
                                    <SessionListIdentity
                                        session={candidate.session}
                                        display={identityDisplay}
                                        serverId={candidate.address?.serverId ?? candidate.serverId ?? null}
                                        color={theme.colors.text.primary}
                                        avatarSize={SESSION_LIST_ROW_IDENTITY_METRICS.compact.slotSize}
                                        agentLogoSize={SESSION_LIST_ROW_IDENTITY_METRICS.compact.agentLogoSize}
                                        connected={getSessionStatus(candidate.session, nowMs, { workingTextMode: 'static' }).isConnected}
                                        testID={`inbox.session.${candidate.sessionId}.identity`}
                                    />
                                ) : undefined}
                                iconBoxSize={identityDisplay !== 'none'
                                    ? SESSION_LIST_ROW_IDENTITY_METRICS.compact.slotSize
                                    : undefined}
                                onPress={() => {
                                    if (candidate.route) navigate(candidate.route);
                                }}
                            />
                        );
                    })}
                    {operationGroups.failedOperations.length > 0 ? (
                        <ActionOperationRows
                            operations={operationGroups.failedOperations}
                            presentation="inbox"
                            onOpenOperation={openOperation}
                            onDismissOperation={resolveOperation}
                        />
                    ) : null}
                </InboxSection>
            ) : null}

            {model.sessionPresentation.readySessions.length > 0 ? (
                <InboxSection
                    testID="inbox.section.ready"
                    title={t('inbox.readySessions')}
                    spacingBefore="following"
                    surface={sectionSurface}
                    rightAccessory={model.sessionPresentation.markAllReadTargets.length > 0 ? (
                        <Pressable
                            testID="inbox.ready.mark_all_read"
                            accessibilityRole="button"
                            accessibilityLabel={t('inbox.markAllRead')}
                            accessibilityState={{ disabled: model.markAllPending }}
                            disabled={model.markAllPending}
                            hitSlop={Platform.select({ ios: 15, default: 17 })}
                            onPress={() => { void model.markRead(model.sessionPresentation.markAllReadTargets); }}
                            style={({ pressed }) => [
                                styles.sectionAction,
                                pressed ? styles.sectionActionPressed : null,
                                model.markAllPending ? styles.sectionActionDisabled : null,
                            ]}
                        >
                            <Text style={styles.sectionActionLabel}>{t('inbox.markAllRead')}</Text>
                        </Pressable>
                    ) : undefined}
                >
                    {model.sessionPresentation.readySessions.map((candidate) => {
                        const serverId = candidate.address?.serverId ?? candidate.serverId ?? null;
                        const target = model.targetBySessionAddress.get(
                            buildServerScopedSessionKey(candidate.sessionId, serverId),
                        );
                        if (!target) return null;
                        return (
                            <InboxReadySessionRow
                                key={target.key}
                                session={candidate.session}
                                identityDisplay={identityDisplay}
                                connected={getSessionStatus(candidate.session, nowMs, { workingTextMode: 'static' }).isConnected}
                                sessionId={candidate.sessionId}
                                serverId={serverId}
                                title={candidate.title}
                                subtitle={buildSessionContextLine(candidate)}
                                pending={model.pendingReadKeys.has(target.key)}
                                onOpen={() => {
                                    if (candidate.route) navigate(candidate.route);
                                }}
                                onMarkRead={() => model.markRead([target])}
                            />
                        );
                    })}
                </InboxSection>
            ) : null}

            {model.openApprovals.length > 0 || actionableSessions.length > 0 || operationGroups.actionable.length > 0 ? (
                <InboxSection
                    testID="inbox.section.needs_attention"
                    title={t('inbox.actionOperations.sections.needsAttention')}
                    spacingBefore="separated"
                    surface={sectionSurface}
                >
                    {model.openApprovals.map((artifact) => {
                        const approvalServerId = typeof artifact.header?.serverIdentityId === 'string'
                            ? artifact.header.serverIdentityId.trim()
                            : typeof artifact.header?.serverId === 'string'
                                ? artifact.header.serverId.trim()
                            : '';
                        const approvalHref = `/inbox/approvals/${encodeURIComponent(artifact.id)}${approvalServerId
                            ? `?serverId=${encodeURIComponent(approvalServerId)}`
                            : ''}`;
                        return (
                            <ApprovalInboxCard
                                key={artifact.id}
                                artifact={artifact}
                                onPress={() => navigate(approvalHref)}
                                audienceScope={typeof artifact.header?.serverId === 'string'
                                    ? model.source.audienceScopes?.get(artifact.header.serverId.trim())
                                    : undefined}
                                workspaceRefs={model.source.workspaceRefsV1 ?? []}
                                workspacePathDisplayModeV1={model.source.workspacePathDisplayModeV1}
                                density="compact"
                            />
                        );
                    })}
                    {actionableSessions.map((entry) => {
                        const candidate = entry.candidate;
                        if (requiresPromptCard(entry)) {
                            return (
                                <InboxSessionAttentionGroupCard
                                    key={candidate.address ? sessionAddressKey(candidate.address) : candidate.sessionId}
                                    session={candidate.session}
                                    serverId={candidate.address?.serverId ?? candidate.serverId ?? null}
                                    identityDisplay={identityDisplay}
                                    connected={getSessionStatus(candidate.session, nowMs, { workingTextMode: 'static' }).isConnected}
                                    contextLine={candidate.context?.contextLine ?? null}
                                    permissionRequests={entry.pendingPermissions}
                                    userActionRequests={entry.pendingUserActions}
                                    onBeforeNavigate={props.onBeforeNavigate}
                                />
                            );
                        }
                        return (
                            <Item
                                key={candidate.address ? sessionAddressKey(candidate.address) : candidate.sessionId}
                                testID={`inbox.session.${candidate.sessionId}`}
                                title={candidate.title}
                                subtitle={buildSessionContextLine(candidate)}
                                density="compact"
                                leftElement={identityDisplay !== 'none' ? (
                                    <SessionListIdentity
                                        session={candidate.session}
                                        display={identityDisplay}
                                        serverId={candidate.address?.serverId ?? candidate.serverId ?? null}
                                        color={theme.colors.text.primary}
                                        avatarSize={SESSION_LIST_ROW_IDENTITY_METRICS.compact.slotSize}
                                        agentLogoSize={SESSION_LIST_ROW_IDENTITY_METRICS.compact.agentLogoSize}
                                        connected={getSessionStatus(candidate.session, nowMs, { workingTextMode: 'static' }).isConnected}
                                        testID={`inbox.session.${candidate.sessionId}.identity`}
                                    />
                                ) : undefined}
                                iconBoxSize={identityDisplay !== 'none'
                                    ? SESSION_LIST_ROW_IDENTITY_METRICS.compact.slotSize
                                    : undefined}
                                onPress={() => {
                                    if (candidate.route) navigate(candidate.route);
                                }}
                            />
                        );
                    })}
                    {operationGroups.actionableOperations.length > 0 ? (
                        <ActionOperationRows
                            operations={operationGroups.actionableOperations}
                            presentation="inbox"
                            onOpenOperation={openOperation}
                            onDismissOperation={resolveOperation}
                        />
                    ) : null}
                </InboxSection>
            ) : null}

            {model.friendRequests.length > 0 ? (
                <InboxSection testID="inbox.section.friends" title={t('friends.pendingRequests')} spacingBefore="separated" surface={sectionSurface}>
                    {model.friendRequests.map((friend) => (
                        <UserCard
                            key={friend.id}
                            user={friend}
                            density="compact"
                            onPress={() => {
                                trackFriendsProfileView();
                                navigate(`/user/${friend.id}`);
                            }}
                        />
                    ))}
                </InboxSection>
            ) : null}

            {model.isLoading && !model.hasPrimaryAttention ? (
                <View style={styles.loadingContainer}>
                    <ActivitySpinner size="large" color={theme.colors.text.secondary} />
                </View>
            ) : null}

            {model.showCaughtUp ? (
                <View style={styles.emptyContainer}>
                    <View style={styles.emptyIconSurface}>
                        <Icon name="check-circle" size={25} color={theme.colors.state.success.foreground} />
                    </View>
                    <Text style={styles.emptyTitle}>{t('inbox.emptyTitle')}</Text>
                    <Text style={styles.emptyDescription}>{t('inbox.emptyDescription')}</Text>
                </View>
            ) : null}

        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        width: '100%',
        flexGrow: 1,
        paddingBottom: 14,
    },
    emptyContainer: {
        flexGrow: 1,
        minHeight: 320,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
        paddingVertical: 48,
    },
    emptyIconSurface: {
        width: 52,
        height: 52,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 18,
        backgroundColor: theme.colors.state.success.background,
        borderWidth: 1,
        borderColor: theme.colors.state.success.border,
    },
    emptyTitle: {
        fontSize: 20,
        lineHeight: 26,
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        marginBottom: 7,
        textAlign: 'center',
    },
    emptyDescription: {
        maxWidth: 360,
        fontSize: 15,
        lineHeight: 21,
        ...Typography.default(),
        color: theme.colors.text.secondary,
        textAlign: 'center',
    },
    loadingContainer: {
        flexGrow: 1,
        minHeight: 240,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionAction: {
        height: 14,
        justifyContent: 'center',
        paddingLeft: 10,
    },
    sectionActionPressed: {
        opacity: 0.62,
    },
    sectionActionDisabled: {
        opacity: 0.42,
    },
    sectionActionLabel: {
        fontSize: 11,
        lineHeight: 14,
        ...Typography.default('semiBold'),
        color: theme.colors.text.secondary,
    },
}));

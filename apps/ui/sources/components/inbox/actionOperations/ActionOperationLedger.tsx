import * as React from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import {
    ItemGroupRowPositionProvider,
    useItemGroupRowPosition,
} from '@/components/ui/lists/ItemGroupRowPosition';
import { InboxSection } from '@/components/inbox/InboxSection';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { t } from '@/text';
import {
    useServerScopedMachine,
    useSessionListRenderableWithServerScope,
} from '@/sync/domains/state/storage';
import { useSessionListHomeObservations } from '@/sync/store/hooks';
import { useAllActionOperations } from '@/sync/domains/actionOperations/useActionOperations';
import { actionOperationStore } from '@/sync/domains/actionOperations/actionOperationStore';
import type { ActionOperationProjection } from '@/sync/domains/actionOperations/actionOperationSelectors';
import {
    actionOperationAddress,
    actionOperationAddressKey,
} from '@/sync/domains/actionOperations/qualifiedActionOperation';
import { areSessionAddressesEqual, type SessionAddress } from '@/sync/domains/session/sessionAddress';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import { useSessionAudienceContext } from '@/hooks/teams/useSessionAudienceContext';

import { openActionOperation } from './actionOperationPresentationRuntime';
import {
    classifyActionOperationSection,
    formatActionOperationAge,
    resolveActionOperationStatus,
    type ActionOperationSection,
} from './actionOperationPresentation';
import { requestAcceptedActionOperationStop } from './requestActionOperationStop';
import { projectActionOperationSourceContext } from './actionOperationSourceContext';

const SECTION_ORDER: readonly ActionOperationSection[] = ['inProgress', 'needsAttention', 'recent'];

function translateHostStatus(value: 'accepted' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'reconnecting' | 'unavailable'): string {
    switch (value) {
        case 'accepted': return t('inbox.actionOperations.status.accepted');
        case 'running': return t('inbox.actionOperations.status.running');
        case 'succeeded': return t('inbox.actionOperations.status.succeeded');
        case 'failed': return t('inbox.actionOperations.status.failed');
        case 'cancelled': return t('inbox.actionOperations.status.cancelled');
        case 'reconnecting': return t('inbox.actionOperations.observation.reconnecting');
        case 'unavailable': return t('inbox.actionOperations.observation.unavailable');
    }
}

function translateSection(section: ActionOperationSection): string {
    switch (section) {
        case 'inProgress': return t('inbox.actionOperations.sections.inProgress');
        case 'needsAttention': return t('inbox.actionOperations.sections.needsAttention');
        case 'recent': return t('inbox.actionOperations.sections.recent');
    }
}

const ActionOperationRow = React.memo(function ActionOperationRow(props: Readonly<{
    operation: ActionOperationProjection;
    presentation?: 'activity' | 'inbox';
    audienceScopes: ReadonlyMap<string, ServerAccountScope>;
    onOpenOperation: (operation: ActionOperationProjection) => void;
    onCancelOperation?: (operation: ActionOperationProjection) => Promise<void> | void;
    onDismissOperation?: (operation: ActionOperationProjection) => void;
    showDivider?: boolean;
}>) {
    const { theme } = useUnistyles();
    const { snapshot, observation } = props.operation;
    const sessionId = snapshot.scope.sessionId ?? null;
    const serverId = props.operation.serverId;
    const session = useSessionListRenderableWithServerScope(serverId, serverId && sessionId ? sessionId : '');
    const machine = useServerScopedMachine(serverId, serverId ? snapshot.scope.machineId : '');
    // Row-local, like this row's Session and Machine reads, so a Home observation change repaints
    // only the rows bound to that Home rather than the whole ledger.
    const homeObservations = useSessionListHomeObservations();
    const status = resolveActionOperationStatus(snapshot, observation);
    const statusLabel = status.label.kind === 'producer'
        ? status.label.value
        : translateHostStatus(status.label.value);
    const sourceContext = projectActionOperationSourceContext({
        serverId,
        snapshot,
        session,
        machine,
        serverProfile: serverId ? getServerProfileById(serverId) : null,
        audienceScope: serverId ? props.audienceScopes.get(serverId) : null,
        homeObservation: serverId ? homeObservations[serverId] ?? null : null,
    });
    const sourceTitle = sourceContext.sessionTitle ?? sourceContext.machineTitle ?? snapshot.actionId;
    const determinateProgress = snapshot.progress?.kind === 'determinate'
        ? t('inbox.actionOperations.progress', {
            current: snapshot.progress.current,
            total: snapshot.progress.total,
        })
        : null;
    const inboxPresentation = props.presentation === 'inbox';
    const subtitleText = inboxPresentation
        ? [props.operation.followUpAttention ?? statusLabel, sourceTitle].filter(Boolean).join(' · ')
        : sourceTitle;
    const detailText = (inboxPresentation
        ? [determinateProgress, sourceContext.contextLine]
        : [
            props.operation.followUpAttention,
            formatActionOperationAge(snapshot),
            determinateProgress,
            sourceContext.contextLine,
        ]).filter(Boolean).join(' · ');
    const active = snapshot.state === 'accepted' || snapshot.state === 'running';
    const canDismiss = Boolean(props.onDismissOperation)
        && (inboxPresentation || (active && props.operation.isUnavailableProjection));
    const canStop = Boolean(serverId)
        && !inboxPresentation
        && !canDismiss
        && observation === 'available'
        && active
        && snapshot.cancellation === 'supported';
    const [stopPending, setStopPending] = React.useState(false);
    const [stopFailed, setStopFailed] = React.useState(false);
    const iconColor = props.operation.followUpAttention || status.tone === 'danger'
        ? theme.colors.status.error
        : status.tone === 'success'
            ? theme.colors.status.connected
            : theme.colors.text.secondary;
    const stop = React.useCallback((event?: GestureResponderEvent) => {
        event?.stopPropagation();
        if (!props.onCancelOperation || stopPending) return;
        setStopPending(true);
        setStopFailed(false);
        Promise.resolve(props.onCancelOperation(props.operation))
            .catch(() => setStopFailed(true))
            .finally(() => setStopPending(false));
    }, [props.onCancelOperation, props.operation, stopPending]);

    return (
        <Item
            testID={`inbox.action-operation.${snapshot.operationId}`}
            title={snapshot.title}
            subtitle={subtitleText}
            detail={detailText || undefined}
            accessibilityLabel={`${snapshot.title}, ${props.operation.followUpAttention ?? statusLabel}, ${detailText}${sourceContext.accessibilityContext ? `, ${sourceContext.accessibilityContext}` : ''}`}
            accessibilityLiveRegion="polite"
            density="compact"
            leftElement={active && observation === 'available'
                ? <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                : <Icon
                    name={status.tone === 'success' ? 'check-circle' : status.tone === 'danger' ? 'warning-circle' : 'clock'}
                    size={ICON_SIZE.md}
                    color={iconColor}
                  />}
            rightElement={canStop ? (
                <Pressable
                    testID={`action-operation-stop.${snapshot.operationId}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('inbox.actionOperations.cancel.stop')}
                    disabled={stopPending}
                    onPress={stop}
                    style={({ pressed }) => [
                        styles.stopButton,
                        pressed ? styles.stopButtonPressed : null,
                        stopPending ? styles.stopButtonPending : null,
                    ]}
                >
                    {stopPending ? (
                        <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                    ) : (
                        <Icon
                            name={stopFailed ? 'warning-circle' : 'stop'}
                            size={ICON_SIZE.sm}
                            color={stopFailed ? theme.colors.status.error : theme.colors.text.secondary}
                        />
                    )}
                </Pressable>
            ) : canDismiss && props.onDismissOperation ? (
                <Pressable
                    testID={`action-operation-dismiss.${snapshot.operationId}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('inbox.actionOperations.dismiss')}
                    onPress={(event) => {
                        event?.stopPropagation();
                        props.onDismissOperation?.(props.operation);
                    }}
                    style={({ pressed }) => [
                        styles.stopButton,
                        pressed ? styles.stopButtonPressed : null,
                    ]}
                >
                    <Icon name="x" size={ICON_SIZE.sm} color={theme.colors.text.secondary} />
                </Pressable>
            ) : undefined}
            rightElementOutsidePressable={true}
            keepChevronWithRightElement={inboxPresentation && canDismiss}
            showDivider={props.showDivider}
            onPress={() => props.onOpenOperation(props.operation)}
        />
    );
});

/**
 * Headerless operation rows for a section whose hierarchy is owned by its host.
 * The row itself remains the one owner of source context, status, and controls.
 */
export const ActionOperationRows = React.memo(function ActionOperationRows(props: Readonly<{
    operations: readonly ActionOperationProjection[];
    presentation?: 'activity' | 'inbox';
    onOpenOperation: (operation: ActionOperationProjection) => void;
    onCancelOperation?: (operation: ActionOperationProjection) => Promise<void> | void;
    onDismissOperation?: (operation: ActionOperationProjection) => void;
    /** Supplied by ItemGroup when this row collection sits among sibling rows. */
    showDivider?: boolean;
}>) {
    useServerProfilesGeneration();
    const sessionAddresses = React.useMemo(() => props.operations.flatMap((operation) => {
        const sessionId = operation.snapshot.scope.sessionId;
        return operation.serverId && sessionId ? [{ serverId: operation.serverId, sessionId }] : [];
    }), [props.operations]);
    const audienceContext = useSessionAudienceContext(sessionAddresses);
    const parentRowPosition = useItemGroupRowPosition();

    return props.operations.map((operation, index) => {
        const isLast = index === props.operations.length - 1;
        return (
            <ItemGroupRowPositionProvider
                key={actionOperationAddressKey(actionOperationAddress(
                    operation.serverId,
                    operation.snapshot.operationId,
                ))}
                value={parentRowPosition ? {
                    isFirst: parentRowPosition.isFirst && index === 0,
                    isLast: parentRowPosition.isLast && isLast,
                } : null}
            >
                <ActionOperationRow
                    operation={operation}
                    presentation={props.presentation}
                    audienceScopes={audienceContext.scopes}
                    onOpenOperation={props.onOpenOperation}
                    onCancelOperation={props.onCancelOperation}
                    onDismissOperation={props.onDismissOperation}
                    showDivider={isLast ? props.showDivider : true}
                />
            </ItemGroupRowPositionProvider>
        );
    });
});

export const ActionOperationLedgerView = React.memo(function ActionOperationLedgerView(props: Readonly<{
    operations: readonly ActionOperationProjection[];
    preferredSessionAddress?: SessionAddress | null;
    onOpenOperation: (operation: ActionOperationProjection) => void;
    onCancelOperation?: (operation: ActionOperationProjection) => Promise<void> | void;
    onDismissOperation?: (operation: ActionOperationProjection) => void;
    onClearRecent?: () => void;
}>) {
    useServerProfilesGeneration();
    const sessionAddresses = React.useMemo(() => props.operations.flatMap((operation) => {
        const sessionId = operation.snapshot.scope.sessionId;
        return operation.serverId && sessionId ? [{ serverId: operation.serverId, sessionId }] : [];
    }), [props.operations]);
    const audienceContext = useSessionAudienceContext(sessionAddresses);
    const sections = React.useMemo(() => {
        const grouped: Record<ActionOperationSection, ActionOperationProjection[]> = {
            inProgress: [],
            needsAttention: [],
            recent: [],
        };
        for (const operation of props.operations) {
            grouped[operation.followUpAttention
                ? 'needsAttention'
                : classifyActionOperationSection(operation.snapshot, operation.observation)].push(operation);
        }
        const preferredSessionAddress = props.preferredSessionAddress ?? null;
        if (preferredSessionAddress) {
            for (const section of SECTION_ORDER) {
                grouped[section].sort((left, right) => {
                    const leftPreferred = areSessionAddressesEqual(
                        left.serverId && left.snapshot.scope.sessionId
                            ? { serverId: left.serverId, sessionId: left.snapshot.scope.sessionId }
                            : null,
                        preferredSessionAddress,
                    );
                    const rightPreferred = areSessionAddressesEqual(
                        right.serverId && right.snapshot.scope.sessionId
                            ? { serverId: right.serverId, sessionId: right.snapshot.scope.sessionId }
                            : null,
                        preferredSessionAddress,
                    );
                    return leftPreferred === rightPreferred ? 0 : leftPreferred ? -1 : 1;
                });
            }
        }
        return grouped;
    }, [props.operations, props.preferredSessionAddress]);

    if (props.operations.length === 0) return null;

    return (
        <View testID="inbox.action-operations" style={styles.container}>
            {SECTION_ORDER.map((section) => sections[section].length > 0 ? (
                <InboxSection
                    key={section}
                    testID={`inbox.section.operations.${section}`}
                    title={translateSection(section)}
                >
                    {sections[section].map((operation) => (
                        <ActionOperationRow
                            key={actionOperationAddressKey(actionOperationAddress(
                                operation.serverId,
                                operation.snapshot.operationId,
                            ))}
                            operation={operation}
                            audienceScopes={audienceContext.scopes}
                            onOpenOperation={props.onOpenOperation}
                            onCancelOperation={props.onCancelOperation}
                            onDismissOperation={props.onDismissOperation}
                        />
                    ))}
                    {section === 'recent' && props.onClearRecent ? (
                        <Item
                            testID="action-operations-clear-recent"
                            title={t('inbox.actionOperations.clearRecent')}
                            density="compact"
                            onPress={props.onClearRecent}
                        />
                    ) : null}
                </InboxSection>
            ) : null)}
        </View>
    );
});

export const ActionOperationLedger = React.memo(function ActionOperationLedger(props: Readonly<{
    preferredSessionAddress?: SessionAddress | null;
}> = {}) {
    const operations = useAllActionOperations();
    const stopOperation = React.useCallback(async (operation: ActionOperationProjection) => {
        await requestAcceptedActionOperationStop(operation);
    }, []);
    return (
        <ActionOperationLedgerView
            operations={operations}
            preferredSessionAddress={props.preferredSessionAddress}
            onOpenOperation={openActionOperation}
            onCancelOperation={stopOperation}
            onDismissOperation={(operation) => actionOperationStore.dismissUnavailable(
                actionOperationAddress(operation.serverId, operation.snapshot.operationId),
            )}
            onClearRecent={actionOperationStore.dismissRecentSucceeded}
        />
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        width: '100%',
    },
    stopButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface.elevated,
    },
    stopButtonPressed: {
        opacity: 0.7,
        transform: [{ scale: 0.94 }],
    },
    stopButtonPending: {
        opacity: 0.45,
    },
}));

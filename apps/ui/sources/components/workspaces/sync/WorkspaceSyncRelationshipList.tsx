import * as React from 'react';
import { useRouter, type Href } from 'expo-router';
import { Platform, View } from 'react-native';

import { IconButton } from '@/components/ui/buttons/IconButton';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';
import {
    disableWorkspaceSyncRelationship,
    enableWorkspaceSyncRelationship,
    flushWorkspaceSyncRelationship,
    terminatePersistedWorkspaceSyncRelationship,
} from '@/sync/ops/workspaceSync';
import {
    resolveWorkspaceSyncErrorTranslationKey,
    formatWorkspaceSyncRelationshipTitle,
    resolveWorkspaceSyncModeTranslationKey,
    resolveWorkspaceSyncStateTranslationKey,
} from '@/sync/domains/sessionHandoff/workspaceSyncPresentation';
import {
    resolveWorkspaceSyncStatusScope,
    useWorkspaceSyncRelationshipSummaries,
} from '@/sync/domains/sessionHandoff/useWorkspaceSyncRelationshipSummaries';
import {
    getWorkspaceSyncStatusSnapshot,
    setWorkspaceSyncStatus,
} from '@/sync/domains/sessionHandoff/workspaceSyncStatusStore';
import type { WorkspaceSyncRelationshipSummary } from '@/sync/domains/sessionHandoff/workspaceSyncRelationshipModel';
import { resolveProjectRoutePathForSurface } from '@/components/workspaceCockpit/project/projectCockpitState';
import { Modal } from '@/modal';
import { formatWithCachedDateTimeFormatter } from '@/utils/datetime/cachedIntlFormatters';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { openWorkspaceSyncRelationshipDetails } from './openWorkspaceSyncRelationshipDetails';

export type WorkspaceSyncRelationshipListProps = Readonly<{
    workspaceRefId?: string | null;
    onOpenDetails?: (summary: WorkspaceSyncRelationshipSummary) => void;
    onOpenConflicts?: (summary: WorkspaceSyncRelationshipSummary) => void;
}>;

const MINIMUM_INTERACTIVE_TARGET_SIZE = resolveMinimumInteractiveTargetSize(Platform.OS);

export const WorkspaceSyncRelationshipRow = React.memo(function WorkspaceSyncRelationshipRow(props: Readonly<{
    summary: WorkspaceSyncRelationshipSummary;
    localWorkspaceRefId?: string | null;
    onOpenDetails?: (summary: WorkspaceSyncRelationshipSummary) => void;
    onOpenConflicts?: (summary: WorkspaceSyncRelationshipSummary) => void;
}>) {
    const router = useRouter();
    const scope = resolveWorkspaceSyncStatusScope(props.summary);
    const snapshot = getWorkspaceSyncStatusSnapshot(scope);
    const status = props.summary.status;
    const modeKey = resolveWorkspaceSyncModeTranslationKey(props.summary.relationship.mode);
    const stateKey = status ? resolveWorkspaceSyncStateTranslationKey(status.state) : null;
    const errorKey = resolveWorkspaceSyncErrorTranslationKey(status?.errorCode);
    const [pendingAction, setPendingAction] = React.useState<'sync' | 'disable' | 'enable' | 'terminate' | null>(null);
    const [menuOpen, setMenuOpen] = React.useState(false);

    const runAction = React.useCallback(async (action: 'sync' | 'disable' | 'enable' | 'terminate') => {
        setPendingAction(action);
        setMenuOpen(false);
        try {
            if (action === 'sync') {
                const nextStatus = await flushWorkspaceSyncRelationship(scope);
                setWorkspaceSyncStatus(scope, nextStatus);
                return;
            }
            if (action === 'terminate') {
                const confirmed = await Modal.confirm(
                    t('workspaceSync.terminate.title'),
                    t('workspaceSync.terminate.body'),
                    {
                        cancelText: t('common.cancel'),
                        confirmText: t('workspaceSync.actions.terminate'),
                        destructive: true,
                    },
                );
                if (!confirmed) return;
                await terminatePersistedWorkspaceSyncRelationship(scope);
                return;
            }
            if (action === 'disable') {
                await disableWorkspaceSyncRelationship(scope);
            } else {
                await enableWorkspaceSyncRelationship(scope);
            }
        } catch {
            Modal.alert(t('common.error'), t('errors.operationFailed'));
        } finally {
            setPendingAction(null);
        }
    }, [scope]);

    const actionItems = React.useMemo<readonly DropdownMenuItem[]>(() => {
        const toggleAction = !props.summary.relationship.enabled
            ? {
                id: 'enable',
                title: t('workspaceSync.actions.resume'),
                icon: undefined,
            }
            : { id: 'disable', title: t('workspaceSync.actions.pause'), icon: undefined };
        return [
            ...(!props.summary.relationship.enabled
                ? []
                : [{ id: 'sync', title: t('workspaceSync.actions.syncNow') }]),
            toggleAction,
            ...(props.summary.alpha.workspaceRef ? [{ id: 'open-alpha', title: t('workspaceSync.actions.openOnMachine', { machine: props.summary.alpha.machineName ?? props.summary.alpha.label }) }] : []),
            ...(props.summary.beta.workspaceRef ? [{ id: 'open-beta', title: t('workspaceSync.actions.openOnMachine', { machine: props.summary.beta.machineName ?? props.summary.beta.label }) }] : []),
            { id: 'terminate', title: t('workspaceSync.actions.terminate') },
        ];
    }, [props.summary.alpha.label, props.summary.alpha.machineName, props.summary.alpha.workspaceRef, props.summary.beta.label, props.summary.beta.machineName, props.summary.beta.workspaceRef, props.summary.relationship.enabled]);

    const handleActionSelect = React.useCallback((action: string) => {
        if (action === 'open-alpha' || action === 'open-beta') {
            const endpoint = action === 'open-alpha' ? props.summary.alpha : props.summary.beta;
            setMenuOpen(false);
            router.push(resolveProjectRoutePathForSurface({
                workspaceRefId: endpoint.workspaceRefId,
                surface: 'browse',
            }) as Href);
            return;
        }
        if (action === 'sync' || action === 'disable' || action === 'enable' || action === 'terminate') {
            void runAction(action);
        }
    }, [props.summary.alpha, props.summary.beta, router, runAction]);

    const lastSyncLabel = status?.lastSuccessfulSyncAtMs == null
        ? t('workspaceSync.neverSynced')
        : t('workspaceSync.lastSynced', {
            at: formatWithCachedDateTimeFormatter(status.lastSuccessfulSyncAtMs, undefined, { dateStyle: 'medium', timeStyle: 'short' }),
        });
    const machineDirectionLabel = props.summary.alpha.machineName || props.summary.beta.machineName
        ? formatWorkspaceSyncRelationshipTitle({
            alphaLabel: props.summary.alpha.machineName ?? props.summary.alpha.label,
            betaLabel: props.summary.beta.machineName ?? props.summary.beta.label,
            mode: props.summary.relationship.mode,
        })
        : null;

    const subtitle = [
        machineDirectionLabel,
        modeKey ? t(modeKey) : t('workspaceSync.unknownMode'),
        pendingAction ? t('workspaceSync.state.working') : null,
        !props.summary.relationship.enabled
            ? t('workspaceSync.state.stopped')
            : status?.errorCode === 'engine_unavailable'
            ? t('workspaceSync.state.engineUnavailable')
            : snapshot.phase === 'error'
            ? t('workspaceSync.state.controllerUnavailable')
            : stateKey
                ? t(stateKey)
                : t('workspaceSync.state.loading'),
        errorKey ? t(errorKey) : null,
        lastSyncLabel,
        status && status.conflictCount > 0 ? t('workspaceSync.conflictCount', { count: status.conflictCount }) : null,
    ].filter(Boolean).join(' · ');
    const conflictCount = status?.conflictCount ?? 0;
    const hasConflicts = conflictCount > 0;
    const openDetails = React.useCallback(() => {
        if (props.onOpenDetails) {
            props.onOpenDetails(props.summary);
            return;
        }
        openWorkspaceSyncRelationshipDetails(props.summary, props.localWorkspaceRefId);
    }, [props.localWorkspaceRefId, props.onOpenDetails, props.summary]);
    const openConflicts = React.useCallback(() => {
        if (props.onOpenConflicts) {
            props.onOpenConflicts(props.summary);
            return;
        }
        openDetails();
    }, [openDetails, props.onOpenConflicts, props.summary]);

    return (
        <Item
            testID={`workspace-sync-relationship-${props.summary.relationshipId}`}
            title={formatWorkspaceSyncRelationshipTitle({
                alphaLabel: props.summary.alpha.label,
                betaLabel: props.summary.beta.label,
                mode: props.summary.relationship.mode,
            })}
            subtitle={subtitle}
            onPress={openDetails}
            showChevron={true}
            rightElementOutsidePressable={true}
            rightElement={(
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {hasConflicts ? (
                        <IconButton
                            testID={`workspace-sync-relationship-${props.summary.relationshipId}-conflicts`}
                            iconName="warning"
                            accessibilityLabel={t('workspaceSync.conflictCount', { count: conflictCount })}
                            tooltip={t('workspaceSync.conflictsTitle')}
                            variant="plain"
                            minimumInteractiveTargetSize={MINIMUM_INTERACTIVE_TARGET_SIZE}
                            onPress={openConflicts}
                        />
                    ) : null}
                    <DropdownMenu
                        open={menuOpen}
                        onOpenChange={setMenuOpen}
                        items={actionItems}
                        onSelect={handleActionSelect}
                        search={false}
                        variant="default"
                        rowKind="item"
                        matchTriggerWidth={false}
                        placement="bottom"
                        popoverAnchorAlign="end"
                        trigger={({ toggle }) => (
                            <IconButton
                                testID={`workspace-sync-relationship-${props.summary.relationshipId}-actions`}
                                iconName="dots-three"
                                accessibilityLabel={t('workspaceSync.actions.more')}
                                tooltip={t('workspaceSync.actions.more')}
                                variant="plain"
                                minimumInteractiveTargetSize={MINIMUM_INTERACTIVE_TARGET_SIZE}
                                disabled={pendingAction !== null}
                                onPress={toggle}
                            />
                        )}
                    />
                </View>
            )}
        />
    );
});

export const WorkspaceSyncRelationshipList = React.memo(function WorkspaceSyncRelationshipList(
    props: WorkspaceSyncRelationshipListProps,
) {
    const summaries = useWorkspaceSyncRelationshipSummaries(props.workspaceRefId);
    return (
        <ItemGroup title={t('workspaceSync.title')} footer={t('workspaceSync.footer')}>
            {summaries.length === 0 ? (
                <Item title={t('workspaceSync.none')} mode="info" />
            ) : summaries.map((summary) => (
                <WorkspaceSyncRelationshipRow
                    key={summary.relationshipId}
                    summary={summary}
                    localWorkspaceRefId={props.workspaceRefId}
                    onOpenDetails={props.onOpenDetails}
                    onOpenConflicts={props.onOpenConflicts}
                />
            ))}
        </ItemGroup>
    );
});

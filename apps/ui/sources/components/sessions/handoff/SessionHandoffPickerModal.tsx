import * as React from 'react';
import { View } from 'react-native';
import {
    evaluateSessionHandoffWorkspaceTransferSourcePathSafety,
    getActionSpec,
    HandoffWorkspaceActionV1Schema,
} from '@happier-dev/protocol';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { CustomModalInjectedProps } from '@/modal';
import { useModalCardChrome } from '@/modal/components/card/useModalCardChrome';
import { t } from '@/text';
import { MachineSelector } from '@/components/sessions/new/components/MachineSelector';
import { PathSelectionList } from '@/components/ui/pathPicker/PathSelectionList';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Item } from '@/components/ui/lists/Item';
import { ExpandableItem } from '@/components/ui/lists/ExpandableItem';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Text, TextInput } from '@/components/ui/text/Text';
import {
    buildSessionHandoffWorkspaceAction,
    normalizeSessionHandoffDefaults,
    parseSessionHandoffIgnoredIncludeGlobs,
    SESSION_HANDOFF_ADVANCED_WORKSPACE_SYNC_MODE_OPTIONS,
    SESSION_HANDOFF_COMMON_WORKSPACE_SYNC_MODE_OPTIONS,
    SESSION_HANDOFF_CONTENT_SELECTION_OPTIONS,
    SESSION_HANDOFF_DIRECT_TARGET_MODE_OPTIONS,
    SESSION_HANDOFF_INCLUDE_IGNORED_MODE_OPTIONS,
    SESSION_HANDOFF_WORKSPACE_SYNC_MODE_OPTIONS,
    type SessionHandoffWorkspaceMode,
} from '@/sync/domains/sessionHandoff/sessionHandoffDefaults';
import { resolveSessionHandoffPickerSourceMachineId } from '@/sync/domains/sessionHandoff/resolveSessionHandoffPickerSourceMachineId';
import {
    selectWorkspaceSyncRelationshipSummariesForHandoff,
    type WorkspaceSyncRelationshipSummary,
} from '@/sync/domains/sessionHandoff/workspaceSyncRelationshipModel';
import { resolveWorkspaceSyncModeTranslationKey } from '@/sync/domains/sessionHandoff/workspaceSyncPresentation';
import { useWorkspaceSyncRelationshipSummaries } from '@/sync/domains/sessionHandoff/useWorkspaceSyncRelationshipSummaries';
import { useWorkspaceSyncEngineReadiness } from '@/sync/domains/sessionHandoff/useWorkspaceSyncEngineReadiness';
import {
    resolveSessionHandoffStartBlockedTranslationKey,
    resolveSessionHandoffStartReadiness,
} from '@/sync/domains/sessionHandoff/resolveSessionHandoffStartReadiness';
import {
    useAllSessionListRenderables,
    useMachineListByServerId,
    useMachineRecordValues,
    useSession,
    useSessionListRenderable,
    useSettingMutable,
} from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';
import { getRecentMachinesFromSessions } from '@/utils/sessions/recentMachines';
import { canAttemptMachineSpawn } from '@/sync/domains/machines/identity/resolveMachineSpawnReadiness';
import { readExternalSessionLink } from '@/sync/domains/session/external/readExternalSessionLink';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';
import { readSessionMetadataLayoutVersion } from '@/sync/engine/sessions/parsePlainSessionPayload';
import { useStableRecentPathsForMachine } from '@/utils/sessions/useStableRecentPathsForMachine';
import { machineMetadataPlatformToTarget } from '@/utils/path/machinePlatform';
import { resolveAbsolutePath } from '@/utils/path/pathUtils';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { resolveServerScopedMachines } from '@/sync/domains/machines/resolveServerScopedMachines';
import { getServerProfileLegacyServerIds } from '@/sync/domains/server/serverProfiles';

import type { SessionHandoffPickerResult } from './openSessionHandoffPicker';
import { Icon } from '@/components/ui/icons/Icon';

export type SessionHandoffPickerModalProps = CustomModalInjectedProps & Readonly<{
    sessionId: string;
    sourceMachineId?: string | null;
    serverId: string | null;
    onResolve: (value: SessionHandoffPickerResult | null) => void;
    onRequestClose?: () => void;
}>;

const stylesheet = StyleSheet.create(() => ({
    body: {
        flex: 1,
    },
    footer: {
        paddingHorizontal: 16,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
    },
    blockedReason: {
        flex: 1,
    },
}));

function normalizeId(raw: unknown): string {
    return String(raw ?? '').trim();
}

function relationshipEndpointTitle(summary: WorkspaceSyncRelationshipSummary): string {
    const separator = summary.relationship.mode === 'keep_both_in_sync' ? ' ↔ ' : ' → ';
    return `${summary.alpha.label}${separator}${summary.beta.label}`;
}

const EMPTY_PATH_SELECTION_FAVORITES = [] as const;
const ignorePathSelectionRequestClose = () => {};

export function SessionHandoffPickerModal({ onClose, setChrome, onResolve, sessionId, sourceMachineId, serverId }: SessionHandoffPickerModalProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const actionSpec = getActionSpec('session.handoff');

    const sessions = useAllSessionListRenderables();
    const sessionRecord = useSession(sessionId);
    const sessionRenderable = useSessionListRenderable(sessionId);
    const machineListByServerId = useMachineListByServerId();
    const activeServerMachines = useMachineRecordValues() ?? [];
    const activeServer = useActiveServerSnapshot();
    const [favoriteMachinesRaw, setFavoriteMachinesRaw] = useSettingMutable('favoriteMachines');
    const [recentMachinePaths] = useSettingMutable('recentMachinePaths');
    const [sessionHandoffDefaultsRaw] = useSettingMutable('sessionHandoffDefaultsV1');
    const relationshipSummaries = useWorkspaceSyncRelationshipSummaries();
    const sessionHandoffDefaults = React.useMemo(
        () => normalizeSessionHandoffDefaults(sessionHandoffDefaultsRaw),
        [sessionHandoffDefaultsRaw],
    );
    const [openWorkspaceSyncModeMenu, setOpenWorkspaceSyncModeMenu] = React.useState(false);
    const [openIgnoredModeMenu, setOpenIgnoredModeMenu] = React.useState(false);
    const [openAdvancedWorkspaceModeMenu, setOpenAdvancedWorkspaceModeMenu] = React.useState(false);
    const [openContentSelectionMenu, setOpenContentSelectionMenu] = React.useState(false);
    const [openDirectTargetModeMenu, setOpenDirectTargetModeMenu] = React.useState(false);

    const allServerMachines = React.useMemo(() => {
        const sid = normalizeId(serverId);
        if (!sid) return [];
        return [...(resolveServerScopedMachines({
            serverId: sid,
            serverIdAliases: getServerProfileLegacyServerIds(sid),
            activeServerId: normalizeId(activeServer.serverId),
            activeMachines: activeServerMachines,
            machineListByServerId,
        }) ?? [])];
    }, [activeServer.serverId, activeServerMachines, machineListByServerId, serverId]);
    const currentSessionMetadata = React.useMemo(() => {
        if (sessionRecord) return readSessionOwnerMetadataView(sessionRecord);
        if (readSessionMetadataLayoutVersion(sessionRenderable?.metadataLayoutVersion) !== 0) return null;
        return sessionRenderable?.metadata ?? null;
    }, [sessionRecord, sessionRenderable]);
    const resolvedSourceMachineId = React.useMemo(
        () => resolveSessionHandoffPickerSourceMachineId({
            sourceMachineId,
            sessionMetadata: currentSessionMetadata,
        }),
        [currentSessionMetadata, sourceMachineId],
    );
    const sourceMachine = React.useMemo(() => {
        if (!resolvedSourceMachineId) return null;
        return allServerMachines.find((machine: any) => normalizeId(machine?.id) === resolvedSourceMachineId) ?? null;
    }, [allServerMachines, resolvedSourceMachineId]);
    const resolvedSourceRootPath = React.useMemo(
        () => resolveAbsolutePath(
            normalizeId(currentSessionMetadata?.path),
            currentSessionMetadata?.homeDir ?? sourceMachine?.metadata?.homeDir,
        ),
        [currentSessionMetadata, sourceMachine],
    );
    const workspaceSourcePathSafety = React.useMemo(() => {
        const sourceHomeDir = currentSessionMetadata?.homeDir;
        const fallbackSourceHomeDir = sourceMachine?.metadata?.homeDir;
        return evaluateSessionHandoffWorkspaceTransferSourcePathSafety({
            sourcePath: resolvedSourceRootPath,
            sourceHomeDir,
            fallbackSourceHomeDir,
        });
    }, [currentSessionMetadata?.homeDir, resolvedSourceRootPath, sourceMachine?.metadata?.homeDir]);
    const isExternalSession = Boolean(
        readExternalSessionLink(currentSessionMetadata),
    );
    const machines = React.useMemo(() => {
        return allServerMachines.filter((machine: any) => {
            const machineId = normalizeId(machine?.id);
            if (!machineId) return false;
            if (machine?.revokedAt) return false;
            if (resolvedSourceMachineId && machineId === resolvedSourceMachineId) return false;
            return true;
        });
    }, [allServerMachines, resolvedSourceMachineId]);
    React.useEffect(() => {
        // Machine storage is the authoritative hydration/event boundary. Its
        // subscription rerenders this picker when the first machine snapshot
        // arrives, so one credential-backed refresh is sufficient.
        if (sync.getCredentials()) {
            void sync.refreshMachinesThrottled({ force: true });
        }
    }, [serverId]);

    const favoriteMachineIds = Array.isArray(favoriteMachinesRaw) ? favoriteMachinesRaw : [];
    const favoriteMachines = React.useMemo(() => {
        const byId = new Map(machines.map((machine: any) => [machine?.id, machine] as const));
        return favoriteMachineIds.map((id) => byId.get(id)).filter(Boolean) as any[];
    }, [favoriteMachineIds, machines]);

    const recentMachines = React.useMemo(() => {
        const allRecent = getRecentMachinesFromSessions({ machines, sessions });
        return allRecent.filter((machine: any) => normalizeId(machine?.id) !== resolvedSourceMachineId);
    }, [machines, resolvedSourceMachineId, sessions]);

    const [selectedMachineId, setSelectedMachineId] = React.useState<string | null>(null);
    const [targetPath, setTargetPath] = React.useState<string | null>(null);
    const selectedMachine = React.useMemo(
        () => machines.find((machine: any) => normalizeId(machine?.id) === normalizeId(selectedMachineId)) ?? null,
        [machines, selectedMachineId],
    );
    const canAttemptSelectedMachine = React.useMemo(
        () => canAttemptMachineSpawn({ machine: selectedMachine as any, selectedMachineId }),
        [selectedMachine, selectedMachineId],
    );
    const recentTargetPaths = useStableRecentPathsForMachine({
        machineId: selectedMachineId,
        recentMachinePaths,
        sessions,
        cacheScopeKey: normalizeId(serverId) || null,
    });
    const targetMachineHomeDir = String(selectedMachine?.metadata?.homeDir ?? '').trim() || '/home';
    const resolvedTargetPath = React.useMemo(
        () => resolveAbsolutePath(targetPath?.trim() ?? '', targetMachineHomeDir),
        [targetMachineHomeDir, targetPath],
    );
    const workspaceTargetPathSafety = React.useMemo(
        () => evaluateSessionHandoffWorkspaceTransferSourcePathSafety({
            sourcePath: resolvedTargetPath,
            sourceHomeDir: targetMachineHomeDir,
        }),
        [resolvedTargetPath, targetMachineHomeDir],
    );
    const recentTargetPathOptions = React.useMemo(
        () => recentTargetPaths.map((path, index) => ({ path, lastUsedAt: index })),
        [recentTargetPaths],
    );
    const [selectedRelationshipId, setSelectedRelationshipId] = React.useState<string | null>(null);
    const handleTargetPathChange = React.useCallback((path: string) => {
        setTargetPath(path.trim() || null);
        setSelectedRelationshipId(null);
    }, []);
    const [workspaceSyncMode, setWorkspaceSyncMode] = React.useState<SessionHandoffWorkspaceMode>(sessionHandoffDefaults.workspaceSyncMode);
    const [advancedExpanded, setAdvancedExpanded] = React.useState(
        sessionHandoffDefaults.workspaceSyncMode === 'mirror_exactly' || sessionHandoffDefaults.workspaceSyncMode === 'keep_both_in_sync',
    );
    const [contentSelection, setContentSelection] = React.useState<'git_worktree' | 'all_files'>('git_worktree');
    const [includeIgnoredMode, setIncludeIgnoredMode] = React.useState<'exclude' | 'include_selected'>(sessionHandoffDefaults.includeIgnoredMode);
    const [ignoredIncludeGlobs, setIgnoredIncludeGlobs] = React.useState<string[]>([...sessionHandoffDefaults.ignoredIncludeGlobs]);
    const [directTargetMode, setDirectTargetMode] = React.useState<'keep_direct' | 'convert_to_persisted'>(sessionHandoffDefaults.directTargetMode);
    const matchingRelationshipSummaries = React.useMemo(
        () => selectWorkspaceSyncRelationshipSummariesForHandoff(relationshipSummaries, {
            source: {
                serverId: normalizeId(serverId),
                machineId: resolvedSourceMachineId ?? '',
                rootPath: resolvedSourceRootPath,
            },
            target: {
                serverId: normalizeId(serverId),
                machineId: normalizeId(selectedMachineId),
                rootPath: resolvedTargetPath,
            },
        }),
        [relationshipSummaries, resolvedSourceMachineId, resolvedSourceRootPath, resolvedTargetPath, selectedMachineId, serverId],
    );
    const selectedRelationshipSummary = React.useMemo(
        () => matchingRelationshipSummaries.find((summary) => summary.relationshipId === selectedRelationshipId) ?? null,
        [matchingRelationshipSummaries, selectedRelationshipId],
    );
    React.useEffect(() => {
        if (selectedRelationshipId && !selectedRelationshipSummary) {
            setSelectedRelationshipId(null);
        }
    }, [selectedRelationshipId, selectedRelationshipSummary]);
    const relationshipChoiceItems = React.useMemo(
        () => matchingRelationshipSummaries.map((summary, index) => ({
            id: `existing-relationship-${index}`,
            relationshipId: summary.relationshipId,
            title: relationshipEndpointTitle(summary),
            subtitle: t(resolveWorkspaceSyncModeTranslationKey(summary.relationship.mode) ?? 'workspaceSync.mode.keepSynced'),
        })),
        [matchingRelationshipSummaries],
    );
    const selectedRelationshipChoice = React.useMemo(
        () => relationshipChoiceItems.find((item) => item.relationshipId === selectedRelationshipId) ?? null,
        [relationshipChoiceItems, selectedRelationshipId],
    );
    const selectedWorkspaceSyncMode = React.useMemo(
        () => SESSION_HANDOFF_WORKSPACE_SYNC_MODE_OPTIONS.find((option) => option.id === workspaceSyncMode)
            ?? SESSION_HANDOFF_WORKSPACE_SYNC_MODE_OPTIONS[0],
        [workspaceSyncMode],
    );
    const selectedContentSelection = SESSION_HANDOFF_CONTENT_SELECTION_OPTIONS.find((option) => option.id === contentSelection)!;
    const workspacePolicyControlsDisabled = workspaceSyncMode === 'none';

    const handleCancel = React.useCallback(() => {
        onResolve(null);
        onClose();
    }, [onClose, onResolve]);

    const parsedWorkspaceAction = React.useMemo(() => {
        const candidate = buildSessionHandoffWorkspaceAction({
            workspaceSyncRelationshipId: selectedRelationshipSummary?.relationshipId,
            workspaceSyncMode,
            contentSelection,
            includeIgnoredMode,
            ignoredIncludeGlobs,
        });
        if (!candidate) return null;
        const parsed = HandoffWorkspaceActionV1Schema.safeParse(candidate);
        return parsed.success ? parsed.data : null;
    }, [contentSelection, ignoredIncludeGlobs, includeIgnoredMode, selectedRelationshipSummary?.relationshipId, workspaceSyncMode]);

    const workspaceEngineRequired = Boolean(selectedRelationshipSummary || workspaceSyncMode !== 'none');
    const sourceEngineReadiness = useWorkspaceSyncEngineReadiness(
        workspaceEngineRequired && resolvedSourceMachineId
            ? { serverId, machineId: resolvedSourceMachineId }
            : null,
    );
    const targetEngineReadiness = useWorkspaceSyncEngineReadiness(
        workspaceEngineRequired && selectedMachineId
            ? { serverId, machineId: selectedMachineId }
            : null,
    );
    const startReadiness = resolveSessionHandoffStartReadiness({
        targetMachineSelected: Boolean(selectedMachine),
        targetMachineAttemptable: canAttemptSelectedMachine,
        relationshipRequested: Boolean(selectedRelationshipId),
        relationshipResolved: Boolean(selectedRelationshipSummary),
        workspaceActionResolved: Boolean(parsedWorkspaceAction),
        workspaceEngineRequired,
        machineCarrierRequired: Boolean(
            resolvedSourceMachineId
            && selectedMachineId
            && resolvedSourceMachineId !== selectedMachineId
        ),
        sourcePathAllowed: workspaceSourcePathSafety.allowed,
        targetPathAllowed: workspaceTargetPathSafety.allowed,
        sourceEngineReadiness,
        targetEngineReadiness,
    });
    const blockedReasonKey = resolveSessionHandoffStartBlockedTranslationKey(startReadiness);

    const handleStart = React.useCallback(() => {
        const targetMachineId = normalizeId(selectedMachineId);
        const sourceRootPath = normalizeId(currentSessionMetadata?.path);
        if (!startReadiness.canStart) return;
        if (!targetMachineId) return;
        if (!canAttemptSelectedMachine) return;
        if (selectedRelationshipId && !selectedRelationshipSummary) return;
        if ((selectedRelationshipSummary || workspaceSyncMode !== 'none') && !workspaceSourcePathSafety.allowed) return;
        if ((selectedRelationshipSummary || workspaceSyncMode !== 'none') && !workspaceTargetPathSafety.allowed) return;
        if (!parsedWorkspaceAction) return;
        onResolve({
            targetMachineId,
            targetMachineLabel: normalizeId(selectedMachine?.metadata?.displayName) || targetMachineId,
            ...(resolvedTargetPath ? { targetPath: resolvedTargetPath } : {}),
            ...(sourceRootPath ? { sourceRootPath } : {}),
            targetSessionStorageMode: isExternalSession
                ? (directTargetMode === 'convert_to_persisted' ? 'persisted' : 'direct')
                : 'persisted',
            workspaceAction: parsedWorkspaceAction,
        });
    }, [canAttemptSelectedMachine, currentSessionMetadata?.path, directTargetMode, isExternalSession, onResolve, parsedWorkspaceAction, resolvedTargetPath, selectedMachine?.metadata?.displayName, selectedMachineId, selectedRelationshipId, selectedRelationshipSummary, startReadiness.canStart, workspaceSourcePathSafety.allowed, workspaceSyncMode, workspaceTargetPathSafety.allowed]);

    const canStart = startReadiness.canStart;

    const footer = React.useMemo(() => (
        <View style={styles.footer}>
            {blockedReasonKey ? (
                <Text
                    testID="session-handoff-start-blocked-reason"
                    style={styles.blockedReason}
                    accessibilityLiveRegion="polite"
                >
                    {t(blockedReasonKey)}
                </Text>
            ) : null}
            <RoundButton display="inverted" title={t('common.cancel')} onPress={handleCancel} />
            <RoundButton
                testID="session-handoff-start"
                title={actionSpec.title}
                onPress={handleStart}
                disabled={!canStart}
                accessibilityHint={blockedReasonKey ? t(blockedReasonKey) : undefined}
            />
        </View>
    ), [actionSpec.title, blockedReasonKey, canStart, handleCancel, handleStart, styles.blockedReason, styles.footer]);

    const chrome = React.useMemo(() => ({
        kind: 'card' as const,
        title: actionSpec.title,
        subtitle: actionSpec.description,
        testID: 'session-handoff-modal',
        dimensions: { width: 520, maxHeightRatio: 0.92 },
        footer,
    }), [actionSpec.description, actionSpec.title, footer]);

    useModalCardChrome(setChrome, chrome);

    return (
        <View style={styles.body}>
                <ItemList keyboardAware style={{ paddingTop: 0 }}>
                    <MachineSelector
                        machines={machines as any}
                        selectedMachine={selectedMachine as any}
                        recentMachines={recentMachines as any}
                        favoriteMachines={favoriteMachines as any}
                        showFavorites={favoriteMachines.length > 0}
                        showRecent={recentMachines.length > 0}
                        showSearch={true}
                        presentation="dropdown"
                        showCliGlyphs={false}
                        autoDetectCliGlyphs={false}
                        disableOfflineMachines={true}
                        testIdPrefix="session-handoff-machine"
                        dropdownTestID="session-handoff-machine-dropdown-trigger"
                        onSelect={(machine: any) => {
                            setSelectedMachineId(normalizeId(machine?.id) || null);
                            setTargetPath(null);
                            setSelectedRelationshipId(null);
                        }}
                        onToggleFavorite={(machine: any) => {
                            const machineId = normalizeId(machine?.id);
                            if (!machineId) return;
                            const exists = favoriteMachineIds.includes(machineId);
                            setFavoriteMachinesRaw(exists ? favoriteMachineIds.filter((id: string) => id !== machineId) : [machineId, ...favoriteMachineIds]);
                        }}
                    />
                    <ItemGroup title={t('machine.launchNewSessionInDirectory')} clipContent>
                        <PathSelectionList
                            machineHomeDir={targetMachineHomeDir}
                            initialValue={targetPath ?? ''}
                            initialSuggestionMode="history"
                            favorites={EMPTY_PATH_SELECTION_FAVORITES}
                            recents={recentTargetPathOptions}
                            machineId={selectedMachineId}
                            serverId={normalizeId(serverId) || null}
                            machinePlatform={machineMetadataPlatformToTarget(selectedMachine?.metadata?.platform)}
                            onCommit={handleTargetPathChange}
                            onChangeDraftPath={handleTargetPathChange}
                            onRequestClose={ignorePathSelectionRequestClose}
                        />
                    </ItemGroup>
                    <ItemGroup
                        title={t('settingsSession.handoff.groupTitle')}
                        footer={t('settingsSession.handoff.groupFooter')}
                    >
                        <DropdownMenu
                            open={openWorkspaceSyncModeMenu}
                            onOpenChange={setOpenWorkspaceSyncModeMenu}
                            variant="selectable"
                            search={false}
                            selectedId={selectedRelationshipChoice?.id ?? workspaceSyncMode}
                            showCategoryTitles={false}
                            matchTriggerWidth={true}
                            connectToTrigger={true}
                            rowKind="item"
                            itemTrigger={{
                                title: selectedRelationshipChoice?.title ?? t('settingsSession.handoff.workspaceMode.title'),
                                subtitle: selectedRelationshipChoice?.subtitle ?? t(selectedWorkspaceSyncMode.subtitleKey),
                                icon: <Icon name="folder" size={16} color={theme.colors.text.secondary} />,
                                itemProps: { testID: 'session-handoff-workspace-sync-mode-trigger' },
                            }}
                            items={[
                                ...SESSION_HANDOFF_COMMON_WORKSPACE_SYNC_MODE_OPTIONS.map((item) => ({
                                    id: item.id,
                                    title: t(item.titleKey),
                                    subtitle: t(item.subtitleKey),
                                })),
                                ...relationshipChoiceItems.map(({ id, title, subtitle }) => ({ id, title, subtitle })),
                            ]}
                            onSelect={(itemId) => {
                                const relationshipChoice = relationshipChoiceItems.find((item) => item.id === itemId);
                                if (relationshipChoice) {
                                    setSelectedRelationshipId(relationshipChoice.relationshipId);
                                    setOpenWorkspaceSyncModeMenu(false);
                                    return;
                                }
                                setSelectedRelationshipId(null);
                                setWorkspaceSyncMode(itemId as SessionHandoffWorkspaceMode);
                                setOpenWorkspaceSyncModeMenu(false);
                            }}
                        />
                        {!selectedRelationshipSummary ? <ExpandableItem
                            testID="session-handoff-advanced"
                            expanded={advancedExpanded}
                            onExpandedChange={setAdvancedExpanded}
                            header={(state) => (
                                <Item
                                    {...state.headerProps}
                                    title={t('settingsSession.handoff.advanced.title')}
                                    subtitle={t('settingsSession.handoff.advanced.subtitle')}
                                    icon={<Icon name="sliders-horizontal" size={16} color={theme.colors.text.secondary} />}
                                    rightElement={<Icon name={state.expanded ? 'caret-down' : 'caret-right'} size={16} color={theme.colors.text.secondary} />}
                                    showChevron={false}
                                />
                            )}
                        >
                            <ItemGroup>
                                <DropdownMenu
                                    open={openAdvancedWorkspaceModeMenu}
                                    onOpenChange={setOpenAdvancedWorkspaceModeMenu}
                                    variant="selectable"
                                    search={false}
                                    selectedId={workspaceSyncMode}
                                    showCategoryTitles={false}
                                    matchTriggerWidth={true}
                                    connectToTrigger={true}
                                    rowKind="item"
                                    itemTrigger={{
                                        title: t('settingsSession.handoff.advanced.modeTitle'),
                                        subtitle: t(selectedWorkspaceSyncMode.subtitleKey),
                                        icon: <Icon name="warning" size={16} color={theme.colors.text.secondary} />,
                                        itemProps: { testID: 'session-handoff-advanced-workspace-mode-trigger' },
                                    }}
                                    items={SESSION_HANDOFF_ADVANCED_WORKSPACE_SYNC_MODE_OPTIONS.map((item) => ({
                                        id: item.id,
                                        title: t(item.titleKey),
                                        subtitle: t(item.subtitleKey),
                                    }))}
                                    onSelect={(itemId) => {
                                        setSelectedRelationshipId(null);
                                        setWorkspaceSyncMode(itemId as SessionHandoffWorkspaceMode);
                                        setOpenAdvancedWorkspaceModeMenu(false);
                                    }}
                                />
                                <DropdownMenu
                                    open={openContentSelectionMenu}
                                    onOpenChange={setOpenContentSelectionMenu}
                                    variant="selectable"
                                    search={false}
                                    selectedId={contentSelection}
                                    showCategoryTitles={false}
                                    matchTriggerWidth={true}
                                    connectToTrigger={true}
                                    rowKind="item"
                                    itemTrigger={{
                                        title: t('settingsSession.handoff.contentSelection.title'),
                                        subtitle: t(selectedContentSelection.subtitleKey),
                                        icon: <Icon name="files" size={16} color={theme.colors.text.secondary} />,
                                        itemProps: { disabled: workspacePolicyControlsDisabled, testID: 'session-handoff-content-selection-trigger' },
                                    }}
                                    items={SESSION_HANDOFF_CONTENT_SELECTION_OPTIONS.map((item) => ({ id: item.id, title: t(item.titleKey), subtitle: t(item.subtitleKey) }))}
                                    onSelect={(itemId) => {
                                        if (workspacePolicyControlsDisabled) return;
                                        setContentSelection(itemId as typeof contentSelection);
                                        setOpenContentSelectionMenu(false);
                                    }}
                                />
                                <DropdownMenu
                                    open={openIgnoredModeMenu}
                                    onOpenChange={setOpenIgnoredModeMenu}
                                    variant="selectable"
                                    search={false}
                                    selectedId={includeIgnoredMode}
                                    showCategoryTitles={false}
                                    matchTriggerWidth={true}
                                    connectToTrigger={true}
                                    rowKind="item"
                                    itemTrigger={{
                                        title: t('settingsSession.handoff.includeIgnoredMode.title'),
                                        subtitle: t('settingsSession.handoff.includeIgnoredMode.subtitle'),
                                        icon: <Icon name="funnel-simple" size={16} color={theme.colors.text.secondary} />,
                                        itemProps: { disabled: workspacePolicyControlsDisabled, testID: 'session-handoff-ignored-mode-trigger' },
                                    }}
                                    items={SESSION_HANDOFF_INCLUDE_IGNORED_MODE_OPTIONS.map((item) => ({ id: item.id, title: t(item.titleKey), subtitle: t(item.subtitleKey) }))}
                                    onSelect={(itemId) => {
                                        if (workspacePolicyControlsDisabled) return;
                                        setIncludeIgnoredMode(itemId as 'exclude' | 'include_selected');
                                        setOpenIgnoredModeMenu(false);
                                    }}
                                />
                                {includeIgnoredMode === 'include_selected' ? (
                                    <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }}>
                                        <Text style={{ fontSize: 14, marginBottom: 8, color: theme.colors.text.secondary }}>{t('settingsSession.handoff.includeIgnoredMode.globsTitle')}</Text>
                                        <TextInput
                                            accessibilityLabel={t('settingsSession.handoff.includeIgnoredMode.globsTitle')}
                                            value={ignoredIncludeGlobs.join(', ')}
                                            onChangeText={(value) => setIgnoredIncludeGlobs(parseSessionHandoffIgnoredIncludeGlobs(value))}
                                            placeholder={t('settingsSession.handoff.includeIgnoredMode.globsPlaceholder')}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            editable={!workspacePolicyControlsDisabled}
                                        />
                                    </View>
                                ) : null}
                            </ItemGroup>
                        </ExpandableItem> : null}
                    </ItemGroup>
                    {isExternalSession ? (
                        <ItemGroup
                            title={t('settingsSession.handoff.directTargetMode.groupTitle')}
                            footer={t('settingsSession.handoff.directTargetMode.groupFooter')}
                        >
                            <DropdownMenu
                                open={openDirectTargetModeMenu}
                                onOpenChange={setOpenDirectTargetModeMenu}
                                variant="selectable"
                                search={false}
                                selectedId={directTargetMode}
                                showCategoryTitles={false}
                                matchTriggerWidth={true}
                                connectToTrigger={true}
                                rowKind="item"
                                itemTrigger={{
                                    title: t('settingsSession.handoff.directTargetMode.title'),
                                    subtitle: t('settingsSession.handoff.directTargetMode.subtitle'),
                                    icon: <Icon name="arrows-left-right" size={16} color={theme.colors.text.secondary} />,
                                }}
                                items={SESSION_HANDOFF_DIRECT_TARGET_MODE_OPTIONS.map((item) => ({
                                    id: item.id,
                                    title: t(item.titleKey),
                                    subtitle: t(item.subtitleKey),
                                }))}
                                onSelect={(itemId) => {
                                    setDirectTargetMode(itemId as 'keep_direct' | 'convert_to_persisted');
                                    setOpenDirectTargetModeMenu(false);
                                }}
                            />
                        </ItemGroup>
                    ) : null}
                </ItemList>
            </View>
    );
}

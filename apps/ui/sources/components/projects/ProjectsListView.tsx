import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';

import { t } from '@/text';
import { ItemList } from '@/components/ui/lists/ItemList';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemGroupTitleWithAction } from '@/components/ui/lists/ItemGroupTitleWithAction';
import { Item } from '@/components/ui/lists/Item';
import { CenteredInfoTile } from '@/components/ui/lists/CenteredInfoTile';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import {
    useAllMachines,
    useSetting,
} from '@/sync/domains/state/storage';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { openMachinePathBrowserModal } from '@/components/ui/pathBrowser/openMachinePathBrowserModal';
import { Modal } from '@/modal';
import { useWorkspaceSyncRelationshipSummaries, resolveWorkspaceSyncStatusScope } from '@/sync/domains/sessionHandoff/useWorkspaceSyncRelationshipSummaries';
import { terminatePersistedWorkspaceSyncRelationship } from '@/sync/ops/workspaceSync';
import {
    addWorkspaceRefToAccount,
    removeWorkspaceRefFromAccount,
    renameWorkspaceRefInAccount,
    resetWorkspaceRefNameInAccount,
    setWorkspaceRefPinnedInAccount,
} from '@/sync/ops/workspaceRefs';
import { workspaceListDirectory } from '@/sync/ops/workspaceFileSystem';
import { resolveMachineActionCandidates } from '@/utils/sessions/resolveMachineActionCandidates';

import type { WorkspaceRefV1 } from '@/sync/domains/workspaces/workspaceRefModel';

import { buildProjectsListGroups } from './projectsListGrouping';
import { ProjectsListItemMenu } from './ProjectsListItemMenu';
import { resolveWorkspaceRefDisplayName } from './resolveWorkspaceRefDisplayName';
import { Icon } from '@/components/ui/icons/Icon';
import { useOpenProject } from './useOpenProject';

export const ProjectsListView = React.memo(() => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const openProject = useOpenProject();
    const activeServer = useActiveServerSnapshot();
    const allMachines = useAllMachines();
    const addFirstMachines = React.useMemo(() => resolveMachineActionCandidates(allMachines), [allMachines]);

    const workspaceRefsV1 = useSetting('workspaceRefsV1');
    const pinnedWorkspaceRefIdsV1 = useSetting('pinnedWorkspaceRefIdsV1');
    // Relationship intent is read from the canonical Account settings projection;
    // Projects keeps no relationship state of its own.
    const workspaceSyncRelationships = useWorkspaceSyncRelationshipSummaries();

    const machinesById = React.useMemo(() => {
        return new Map(allMachines.map((machine) => [machine.id, machine] as const));
    }, [allMachines]);

    const groups = React.useMemo(() => {
        return buildProjectsListGroups({
            activeServerId: String(activeServer.serverId ?? '').trim(),
            workspaceRefs: Array.isArray(workspaceRefsV1) ? workspaceRefsV1 : [],
            pinnedWorkspaceRefIds: Array.isArray(pinnedWorkspaceRefIdsV1) ? pinnedWorkspaceRefIdsV1 : [],
        });
    }, [activeServer.serverId, pinnedWorkspaceRefIdsV1, workspaceRefsV1]);

    const handleAddProjectToMachine = React.useCallback(async (machineId: string) => {
        const serverId = String(activeServer.serverId ?? '').trim();
        if (!serverId) return;
        const selected = await openMachinePathBrowserModal({
            machineId,
            serverId,
            title: t('newSession.selectPathTitle'),
            selectionMode: 'directory',
        });
        if (!selected) return;
        const selectedRootPath = selected.trim();
        if (!selectedRootPath) return;

        const preflight = await workspaceListDirectory({ serverId, machineId, rootPath: selectedRootPath }, '');
        if (!preflight.success) {
            Modal.alert(t('common.error'), preflight.error);
            return;
        }

        const nowMs = Date.now();
        const added = await addWorkspaceRefToAccount({
            scope: { serverId, machineId, rootPath: selectedRootPath },
            nowMs,
            patch: { lastOpenedAtMs: nowMs },
        });
        if (!added.ok || !('workspaceRefId' in added)) {
            Modal.alert(t('common.error'), t('common.saveError'));
            return;
        }
        router.push(`/projects/${encodeURIComponent(added.workspaceRefId)}`);
    }, [activeServer.serverId, router]);

    const pinnedIdSet = React.useMemo(() => {
        return new Set(Array.isArray(pinnedWorkspaceRefIdsV1) ? pinnedWorkspaceRefIdsV1 : []);
    }, [pinnedWorkspaceRefIdsV1]);

    const handleTogglePinned = React.useCallback(async (workspaceRefId: string) => {
        const serverId = String(activeServer.serverId ?? '').trim();
        if (!serverId) return;
        const id = String(workspaceRefId ?? '').trim();
        if (!id) return;
        const result = await setWorkspaceRefPinnedInAccount({
            serverId,
            workspaceRefId: id,
            pinned: !pinnedIdSet.has(id),
        });
        if (!result.ok) {
            Modal.alert(t('common.error'), t('common.saveError'));
        }
    }, [activeServer.serverId, pinnedIdSet]);

    const handleRenameProject = React.useCallback(async (workspaceRef: WorkspaceRefV1) => {
        const serverId = String(activeServer.serverId ?? '').trim();
        if (!serverId) return;
        const currentLabel = resolveWorkspaceRefDisplayName(workspaceRef);
        const newName = await Modal.prompt(
            t('sessionsList.renameWorkspacePromptTitle'),
            undefined,
            {
                defaultValue: currentLabel,
                placeholder: t('sessionsList.renameWorkspacePromptPlaceholder'),
                confirmText: t('common.save'),
                cancelText: t('common.cancel'),
            },
        );
        if (newName == null) return;
        const trimmed = newName.trim();
        if (!trimmed) return;

        const result = await renameWorkspaceRefInAccount({
            serverId,
            workspaceRefId: workspaceRef.id,
            label: trimmed,
        });
        if (!result.ok) {
            Modal.alert(t('common.error'), t('common.saveError'));
        }
    }, [activeServer.serverId]);

    const handleResetProjectName = React.useCallback(async (workspaceRef: WorkspaceRefV1) => {
        const serverId = String(activeServer.serverId ?? '').trim();
        if (!serverId) return;
        const result = await resetWorkspaceRefNameInAccount({
            serverId,
            workspaceRefId: workspaceRef.id,
        });
        if (!result.ok) {
            Modal.alert(t('common.error'), t('common.saveError'));
        }
    }, [activeServer.serverId]);

    const handleRemoveProject = React.useCallback(async (workspaceRef: WorkspaceRefV1) => {
        const serverId = String(activeServer.serverId ?? '').trim();
        if (!serverId) return;
        const id = String(workspaceRef.id ?? '').trim();
        if (!id) return;

        let removal = await removeWorkspaceRefFromAccount({ serverId, workspaceRefId: id });

        if (!removal.ok && removal.code === 'workspace_ref_in_use') {
            const blockingRelationshipIds = removal.relationshipIds;
            const blocking = workspaceSyncRelationships.filter(
                (summary) => blockingRelationshipIds.includes(summary.relationshipId),
            );
            if (blocking.length !== blockingRelationshipIds.length) {
                Modal.alert(t('common.error'), t('projects.actions.removeStopSyncingFailed'));
                return;
            }
            const confirmed = await Modal.confirm(
                t('projects.actions.removeBlockedBySyncTitle'),
                t('projects.actions.removeBlockedBySyncBody', { count: blocking.length }),
                { confirmText: t('projects.actions.removeBlockedBySyncConfirm'), destructive: true },
            );
            if (!confirmed) return;
            try {
                // Stop syncing through the canonical daemon relationship owner;
                // the reference is only released once nothing still points at it.
                for (const summary of blocking) {
                    await terminatePersistedWorkspaceSyncRelationship(resolveWorkspaceSyncStatusScope(summary));
                }
            } catch {
                Modal.alert(t('common.error'), t('projects.actions.removeStopSyncingFailed'));
                return;
            }
            removal = await removeWorkspaceRefFromAccount({ serverId, workspaceRefId: id });
        }

        if (!removal.ok) {
            Modal.alert(t('common.error'), t('projects.actions.removeStopSyncingFailed'));
        }
    }, [
        activeServer.serverId,
        workspaceSyncRelationships,
    ]);

    const hasAnyProjects = groups.pinned.length > 0 || groups.machineGroups.length > 0;

    return (
        <ItemList
            testID="projects-list"
            containerStyle={{ paddingTop: 12 }}
        >
            {!hasAnyProjects ? (
                <CenteredInfoTile
                    icon={(
                        <Icon
                            name="folder-open"
                            size={48}
                            color={theme.colors.text.secondary}
                            style={{ marginBottom: 12 }}
                        />
                    )}
                    title={t('projects.emptyTitle')}
                    description={t('projects.emptyDescription')}
                />
            ) : null}

            {groups.pinned.length > 0 ? (
                <ItemGroup title={t('projects.groups.pinned')}>
                    {groups.pinned.map((workspaceRef) => (
                        <Item
                            key={workspaceRef.id}
                            testID={`projects-list-item-${workspaceRef.id}`}
                            title={resolveWorkspaceRefDisplayName(workspaceRef)}
                            subtitle={workspaceRef.rootPath}
                            subtitleLines={1}
                            icon={<Icon name="folder" size={20} color={theme.colors.text.secondary} />}
                            rightElement={(
                                <ProjectsListItemMenu
                                    theme={theme}
                                    workspaceRef={workspaceRef}
                                    pinAction="unpin"
                                    onTogglePinned={handleTogglePinned}
                                    onRename={handleRenameProject}
                                    onReset={handleResetProjectName}
                                    onRemove={handleRemoveProject}
                                />
                            )}
                            onPress={() => { openProject(workspaceRef.id); }}
                        />
                    ))}
                </ItemGroup>
            ) : null}

            {groups.machineGroups.map((group) => {
                const machine = machinesById.get(group.machineId) ?? null;
                const machineName = getMachineDisplayName(machine) ?? group.machineId;
                return (
                    <ItemGroup
                        key={group.machineId}
                        title={(
                            <ItemGroupTitleWithAction
                                title={machineName}
                                action={{
                                    testID: `projects-add-machine:${group.machineId}`,
                                    accessibilityLabel: t('projects.actions.addProjectToMachine'),
                                    iconName: 'plus',
                                    iconColor: theme.colors.text.secondary,
                                    disabled: false,
                                    onPress: () => { void handleAddProjectToMachine(group.machineId); },
                                }}
                            />
                        )}
                    >
                        {group.items.map((workspaceRef) => (
                            <Item
                                key={workspaceRef.id}
                                testID={`projects-list-item-${workspaceRef.id}`}
                                title={resolveWorkspaceRefDisplayName(workspaceRef)}
                                subtitle={workspaceRef.rootPath}
                                subtitleLines={1}
                                icon={<Icon name="folder" size={20} color={theme.colors.text.secondary} />}
                                rightElement={(
                                    <ProjectsListItemMenu
                                        theme={theme}
                                        workspaceRef={workspaceRef}
                                        pinAction={pinnedIdSet.has(workspaceRef.id) ? 'unpin' : 'pin'}
                                        onTogglePinned={handleTogglePinned}
                                        onRename={handleRenameProject}
                                        onReset={handleResetProjectName}
                                        onRemove={handleRemoveProject}
                                    />
                                )}
                                onPress={() => { openProject(workspaceRef.id); }}
                            />
                        ))}
                    </ItemGroup>
                );
            })}

            {allMachines.length > 0 && !hasAnyProjects ? (
                <ItemGroup title={t('projects.groups.addFirst')}>
                    {addFirstMachines.map((machine) => (
                        <Item
                            key={machine.id}
                            testID={`projects-add-first-machine:${machine.id}`}
                            title={t('projects.actions.chooseProjectFolderOnMachine', {
                                machine: getMachineDisplayName(machine) ?? machine.metadata?.host ?? machine.id,
                            })}
                            subtitle={t('projects.actions.chooseProjectFolderSubtitle')}
                            icon={<Icon name="desktop" size={20} color={theme.colors.text.secondary} />}
                            onPress={() => { void handleAddProjectToMachine(machine.id); }}
                        />
                    ))}
                </ItemGroup>
            ) : null}
        </ItemList>
    );
});

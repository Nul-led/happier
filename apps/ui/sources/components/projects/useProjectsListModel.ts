import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import { t } from '@/text';
import { useAllMachines, useSetting } from '@/sync/domains/state/storage';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { openMachinePathBrowserModal } from '@/components/ui/pathBrowser/openMachinePathBrowserModal';
import { Modal } from '@/modal';
import { useWorkspaceSyncRelationshipSummaries, resolveWorkspaceSyncStatusScope } from '@/sync/domains/sessionHandoff/useWorkspaceSyncRelationshipSummaries';
import { projectWorkspaceSyncSetAttentionByWorkspaceRefId } from '@/sync/domains/sessionHandoff/workspaceSyncRelationshipModel';
import { formatWorkspaceSyncSetAttention } from '@/sync/domains/sessionHandoff/workspaceSyncPresentation';
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
import { resolveWorkspaceRefDisplayName } from './resolveWorkspaceRefDisplayName';
import { useOpenProject } from './useOpenProject';

/**
 * The one model of the Projects list — its grouping (pinned, then per machine), each project's
 * subtitle and attention, and every action on a project — shared by the Projects page and the
 * Projects column, so the two can never disagree about what a project is or what it does.
 */
export function useProjectsListModel() {
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
    const workspaceSyncAttentionByRefId = React.useMemo(
        () => projectWorkspaceSyncSetAttentionByWorkspaceRefId(workspaceSyncRelationships),
        [workspaceSyncRelationships],
    );
    const workspaceSubtitle = React.useCallback((workspaceRef: WorkspaceRefV1) => {
        const attention = workspaceSyncAttentionByRefId.get(workspaceRef.id);
        const label = attention ? formatWorkspaceSyncSetAttention(attention) : null;
        return label
            ? `${workspaceRef.rootPath} · ${label}`
            : workspaceRef.rootPath;
    }, [workspaceSyncAttentionByRefId]);
    const workspaceSubtitleLines = React.useCallback((workspaceRef: WorkspaceRefV1) => {
        const attention = workspaceSyncAttentionByRefId.get(workspaceRef.id);
        return attention?.conflictedLinkCount || attention?.unknownLinkCount ? 2 : 1;
    }, [workspaceSyncAttentionByRefId]);

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

    const addProjectToMachine = React.useCallback(async (machineId: string) => {
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
        if (!added.ok || !('workspaceRefId' in added) || typeof added.workspaceRefId !== 'string') {
            Modal.alert(t('common.error'), t('common.saveError'));
            return;
        }
        router.push(`/projects/${encodeURIComponent(added.workspaceRefId)}`);
    }, [activeServer.serverId, router]);

    const pinnedIdSet = React.useMemo(() => {
        return new Set(Array.isArray(pinnedWorkspaceRefIdsV1) ? pinnedWorkspaceRefIdsV1 : []);
    }, [pinnedWorkspaceRefIdsV1]);

    const togglePinned = React.useCallback(async (workspaceRefId: string) => {
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

    const renameProject = React.useCallback(async (workspaceRef: WorkspaceRefV1) => {
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

    const resetProjectName = React.useCallback(async (workspaceRef: WorkspaceRefV1) => {
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

    const removeProject = React.useCallback(async (workspaceRef: WorkspaceRefV1) => {
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
    const projectCount = groups.pinned.length
        + groups.machineGroups.reduce((count, group) => count + group.items.length, 0);

    return {
        groups,
        hasAnyProjects,
        projectCount,
        allMachines,
        addFirstMachines,
        machinesById,
        pinnedIdSet,
        workspaceSubtitle,
        workspaceSubtitleLines,
        openProject,
        addProjectToMachine,
        togglePinned,
        renameProject,
        resetProjectName,
        removeProject,
    };
}

export type ProjectsListModel = ReturnType<typeof useProjectsListModel>;

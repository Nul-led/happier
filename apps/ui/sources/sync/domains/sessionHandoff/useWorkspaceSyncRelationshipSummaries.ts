import * as React from 'react';

import { useMachineDisplayNamesById, useSetting } from '@/sync/domains/state/storage';
import {
    projectWorkspaceSyncRelationships,
    projectWorkspaceSyncRelationshipSummaries,
    type WorkspaceSyncRelationshipSummary,
} from './workspaceSyncRelationshipModel';
import {
    getWorkspaceSyncStatusSnapshot,
    refreshWorkspaceSyncStatus,
    subscribeWorkspaceSyncStatus,
    type WorkspaceSyncStatusScope,
} from './workspaceSyncStatusStore';

function scopeFor(summary: WorkspaceSyncRelationshipSummary): WorkspaceSyncStatusScope {
    const controllerEndpoint = [summary.alpha, summary.beta].find(
        (endpoint) => endpoint.workspaceRef?.machineId === summary.relationship.controllerMachineId,
    );
    return {
        relationshipId: summary.relationshipId,
        controllerMachineId: summary.relationship.controllerMachineId,
        serverId: controllerEndpoint?.workspaceRef?.serverId
            ?? summary.alpha.workspaceRef?.serverId
            ?? summary.beta.workspaceRef?.serverId,
    };
}

export function useWorkspaceSyncRelationshipSummaries(
    workspaceRefId?: string | null,
): readonly WorkspaceSyncRelationshipSummary[] {
    const rawRelationships = useSetting('workspaceSyncRelationshipsV1');
    const workspaceRefs = useSetting('workspaceRefsV1');
    const relationshipModel = React.useMemo(
        () => projectWorkspaceSyncRelationships(rawRelationships),
        [rawRelationships],
    );
    const machineIds = React.useMemo(() => {
        const workspaceRefsById = new Map(workspaceRefs.map((workspaceRef) => [workspaceRef.id, workspaceRef]));
        return relationshipModel.all.flatMap((relationship) => [
            workspaceRefsById.get(relationship.alphaWorkspaceRefId)?.machineId,
            workspaceRefsById.get(relationship.betaWorkspaceRefId)?.machineId,
        ]).filter((machineId): machineId is string => typeof machineId === 'string' && machineId.length > 0);
    }, [relationshipModel, workspaceRefs]);
    const machineNamesById = useMachineDisplayNamesById(machineIds);
    const baseSummaries = React.useMemo(
        () => projectWorkspaceSyncRelationshipSummaries({ relationships: relationshipModel, workspaceRefs, statuses: [], machineNamesById }),
        [machineNamesById, relationshipModel, workspaceRefs],
    );
    const scopedBaseSummaries = React.useMemo(
        () => baseSummaries.filter((summary) => workspaceRefId === undefined
            || (workspaceRefId !== null && (
                summary.alpha.workspaceRefId === workspaceRefId
                || summary.beta.workspaceRefId === workspaceRefId
            ))),
        [baseSummaries, workspaceRefId],
    );
    const [revision, incrementRevision] = React.useReducer((value: number) => value + 1, 0);

    React.useEffect(() => {
        const unsubscribers = scopedBaseSummaries.map((summary) => {
            if (!summary.relationship.enabled) return () => {};
            const scope = scopeFor(summary);
            const unsubscribe = subscribeWorkspaceSyncStatus(scope, incrementRevision);
            if (getWorkspaceSyncStatusSnapshot(scope).phase === 'idle') {
                void refreshWorkspaceSyncStatus(scope).catch(() => undefined);
            }
            return unsubscribe;
        });
        return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    }, [scopedBaseSummaries]);

    return React.useMemo(() => {
        const statuses = scopedBaseSummaries.flatMap((summary) => {
            if (!summary.relationship.enabled) return [];
            const status = getWorkspaceSyncStatusSnapshot(scopeFor(summary)).status;
            return status ? [status] : [];
        });
        return projectWorkspaceSyncRelationshipSummaries({
            relationships: relationshipModel,
            workspaceRefs,
            statuses,
            machineNamesById,
        }).filter((summary) => workspaceRefId === undefined
            || (workspaceRefId !== null && (
                summary.alpha.workspaceRefId === workspaceRefId
                || summary.beta.workspaceRefId === workspaceRefId
            )));
    }, [machineNamesById, relationshipModel, revision, scopedBaseSummaries, workspaceRefId, workspaceRefs]);
}

export function resolveWorkspaceSyncStatusScope(summary: WorkspaceSyncRelationshipSummary): WorkspaceSyncStatusScope {
    return scopeFor(summary);
}

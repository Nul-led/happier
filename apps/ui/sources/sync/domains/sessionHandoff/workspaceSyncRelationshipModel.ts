import {
    WorkspaceSyncRelationshipV1Schema,
    type WorkspaceRefV1,
    type WorkspaceSyncRelationshipV1,
    type WorkspaceSyncStatusV1,
} from '@happier-dev/protocol';

import {
    normalizeWorkspaceScopeBase,
    type WorkspaceScopeBase,
} from '@/sync/domains/workspaces/workspaceScope';

export type WorkspaceSyncRelationshipModel = Readonly<{
    all: readonly WorkspaceSyncRelationshipV1[];
    enabled: readonly WorkspaceSyncRelationshipV1[];
    byId: ReadonlyMap<string, WorkspaceSyncRelationshipV1>;
    invalidCount: number;
}>;

export type WorkspaceSyncRelationshipEndpoint = Readonly<{
    workspaceRefId: string;
    workspaceRef: WorkspaceRefV1 | null;
    label: string;
    machineName: string | null;
}>;

export type WorkspaceSyncRelationshipSummary = Readonly<{
    relationshipId: string;
    relationship: WorkspaceSyncRelationshipV1;
    alpha: WorkspaceSyncRelationshipEndpoint;
    beta: WorkspaceSyncRelationshipEndpoint;
    status: WorkspaceSyncStatusV1 | null;
}>;

const EMPTY_RELATIONSHIPS: readonly unknown[] = [];

/**
 * Single fail-closed projection for persisted relationship definitions.
 * Runtime status remains daemon-owned and must not be inferred here.
 */
export function projectWorkspaceSyncRelationships(raw: unknown): WorkspaceSyncRelationshipModel {
    const entries = Array.isArray(raw) ? raw : EMPTY_RELATIONSHIPS;
    const byId = new Map<string, WorkspaceSyncRelationshipV1>();
    const all: WorkspaceSyncRelationshipV1[] = [];
    let invalidCount = 0;

    for (const entry of entries) {
        const parsed = WorkspaceSyncRelationshipV1Schema.safeParse(entry);
        if (!parsed.success) {
            invalidCount += 1;
            continue;
        }
        all.push(parsed.data);
        byId.set(parsed.data.relationshipId, parsed.data);
    }

    return {
        all,
        enabled: all.filter((relationship) => relationship.enabled),
        byId,
        invalidCount,
    };
}

function endpointFor(
    workspaceRefId: string,
    workspaceRefsById: ReadonlyMap<string, WorkspaceRefV1>,
    machineNamesById: Readonly<Record<string, string>>,
): WorkspaceSyncRelationshipEndpoint {
    const workspaceRef = workspaceRefsById.get(workspaceRefId) ?? null;
    const machineId = workspaceRef?.machineId ?? '';
    const machineName = machineId ? machineNamesById[machineId]?.trim() || null : null;
    return {
        workspaceRefId,
        workspaceRef,
        label: workspaceRef?.label?.trim() || workspaceRef?.rootPath || workspaceRefId,
        machineName,
    };
}

/**
 * Canonical UI projection for endpoint identity and daemon-owned status. Repeated
 * status observations are collapsed by relationship instead of becoming rows.
 */
export function projectWorkspaceSyncRelationshipSummaries(input: Readonly<{
    relationships: WorkspaceSyncRelationshipModel;
    workspaceRefs: readonly WorkspaceRefV1[];
    statuses: readonly WorkspaceSyncStatusV1[];
    machineNamesById?: Readonly<Record<string, string>>;
}>): readonly WorkspaceSyncRelationshipSummary[] {
    const workspaceRefsById = new Map(input.workspaceRefs.map((workspaceRef) => [workspaceRef.id, workspaceRef]));
    const statusesByRelationshipId = new Map(
        input.statuses.map((status) => [status.relationshipId, status]),
    );

    return input.relationships.all.map((relationship) => ({
        relationshipId: relationship.relationshipId,
        relationship,
        alpha: endpointFor(relationship.alphaWorkspaceRefId, workspaceRefsById, input.machineNamesById ?? {}),
        beta: endpointFor(relationship.betaWorkspaceRefId, workspaceRefsById, input.machineNamesById ?? {}),
        status: statusesByRelationshipId.get(relationship.relationshipId) ?? null,
    }));
}

function endpointMatchesScope(
    endpoint: WorkspaceSyncRelationshipEndpoint,
    scope: WorkspaceScopeBase,
): boolean {
    const endpointScope = endpoint.workspaceRef
        ? normalizeWorkspaceScopeBase(endpoint.workspaceRef)
        : null;
    return endpointScope !== null
        && endpointScope.serverId === scope.serverId
        && endpointScope.machineId === scope.machineId
        && endpointScope.rootPath === scope.rootPath;
}

/**
 * Existing handoff choices must match both concrete endpoints. One-way modes
 * preserve their alpha-to-beta direction; only the bidirectional mode can be
 * selected with the current handoff source and target reversed.
 */
export function selectWorkspaceSyncRelationshipSummariesForHandoff(
    summaries: readonly WorkspaceSyncRelationshipSummary[],
    scopes: Readonly<{ source: WorkspaceScopeBase; target: WorkspaceScopeBase }>,
): readonly WorkspaceSyncRelationshipSummary[] {
    const source = normalizeWorkspaceScopeBase(scopes.source);
    const target = normalizeWorkspaceScopeBase(scopes.target);
    if (!source || !target) return [];

    return summaries.filter((summary) => {
        if (!summary.relationship.enabled) return false;
        if (!summary.alpha.workspaceRef || !summary.beta.workspaceRef) return false;

        const forward = endpointMatchesScope(summary.alpha, source)
            && endpointMatchesScope(summary.beta, target);
        if (forward) return true;

        return summary.relationship.mode === 'keep_both_in_sync'
            && endpointMatchesScope(summary.beta, source)
            && endpointMatchesScope(summary.alpha, target);
    });
}

export function resolveWorkspaceSyncConflictCountForWorkspaceRef(
    summaries: readonly WorkspaceSyncRelationshipSummary[],
    workspaceRefId: string,
): number {
    const conflictsByRelationshipId = new Map<string, number>();
    for (const summary of summaries) {
        if (!summary.relationship.enabled) continue;
        if (
            summary.alpha.workspaceRefId !== workspaceRefId
            && summary.beta.workspaceRefId !== workspaceRefId
        ) continue;
        conflictsByRelationshipId.set(summary.relationshipId, summary.status?.conflictCount ?? 0);
    }
    return [...conflictsByRelationshipId.values()].reduce((total, count) => total + count, 0);
}

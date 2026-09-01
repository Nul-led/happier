export type WorkspaceSyncModeTranslationKey =
    | 'workspaceSync.mode.copyOnce'
    | 'workspaceSync.mode.keepSynced'
    | 'workspaceSync.mode.mirrorExactly'
    | 'workspaceSync.mode.keepBothInSync';

export type WorkspaceSyncStateTranslationKey =
    | 'workspaceSync.state.starting'
    | 'workspaceSync.state.watching'
    | 'workspaceSync.state.flushing'
    | 'workspaceSync.state.paused'
    | 'workspaceSync.state.peerOffline'
    | 'workspaceSync.state.conflicted'
    | 'workspaceSync.state.controllerUnavailable'
    | 'workspaceSync.state.error'
    | 'workspaceSync.state.stopped';

export type WorkspaceSyncErrorTranslationKey =
    | 'workspaceSync.error.componentUnavailable'
    | 'workspaceSync.error.machineOffline'
    | 'workspaceSync.error.destinationNeedsPreparation'
    | 'workspaceSync.error.gitPreparationFailed'
    | 'workspaceSync.error.authorizationExpired'
    | 'workspaceSync.error.rootNoLongerAuthorized'
    | 'workspaceSync.error.conflictNeedsAttention'
    | 'workspaceSync.error.needsAttention';

export function resolveWorkspaceSyncModeTranslationKey(value: unknown): WorkspaceSyncModeTranslationKey | null {
    switch (value) {
        case 'copy_once': return 'workspaceSync.mode.copyOnce';
        case 'keep_synced': return 'workspaceSync.mode.keepSynced';
        case 'mirror_exactly': return 'workspaceSync.mode.mirrorExactly';
        case 'keep_both_in_sync': return 'workspaceSync.mode.keepBothInSync';
        default: return null;
    }
}

export function formatWorkspaceSyncRelationshipTitle(input: Readonly<{
    alphaLabel: string;
    betaLabel: string;
    mode: unknown;
}>): string {
    const separator = input.mode === 'keep_both_in_sync' ? ' ↔ ' : ' → ';
    return `${input.alphaLabel}${separator}${input.betaLabel}`;
}

export type WorkspaceSyncConflictOpenTarget =
    | Readonly<{ kind: 'none' }>
    | Readonly<{ kind: 'relationship'; relationshipId: string }>
    | Readonly<{ kind: 'relationshipList' }>;

export function resolveWorkspaceSyncConflictOpenTarget(
    relationships: readonly Readonly<{ relationshipId: string; conflictCount: number }>[],
): WorkspaceSyncConflictOpenTarget {
    const conflicted = relationships.filter((relationship) => relationship.conflictCount > 0);
    if (conflicted.length === 0) return { kind: 'none' };
    if (conflicted.length === 1) {
        return { kind: 'relationship', relationshipId: conflicted[0]!.relationshipId };
    }
    return { kind: 'relationshipList' };
}

export function resolveWorkspaceSyncStateTranslationKey(value: unknown): WorkspaceSyncStateTranslationKey | null {
    switch (value) {
        case 'starting': return 'workspaceSync.state.starting';
        case 'watching': return 'workspaceSync.state.watching';
        case 'flushing': return 'workspaceSync.state.flushing';
        case 'paused': return 'workspaceSync.state.paused';
        case 'disconnected': return 'workspaceSync.state.peerOffline';
        case 'conflicted': return 'workspaceSync.state.conflicted';
        case 'controller_unavailable': return 'workspaceSync.state.controllerUnavailable';
        case 'error': return 'workspaceSync.state.error';
        case 'stopped': return 'workspaceSync.state.stopped';
        default: return null;
    }
}

/** Keep daemon diagnostics behind the UI boundary and present the next useful action. */
export function resolveWorkspaceSyncErrorTranslationKey(value: unknown): WorkspaceSyncErrorTranslationKey | null {
    if (typeof value !== 'string' || value.length === 0) return null;
    switch (value) {
        case 'engine_unavailable':
        case 'mutagen_fork_release_commit_required':
            return 'workspaceSync.error.componentUnavailable';
        case 'machine_carrier_unavailable':
        case 'controller_unavailable':
        case 'peer_unavailable':
            return 'workspaceSync.error.machineOffline';
        case 'target_bootstrap_required':
        case 'target_not_empty':
            return 'workspaceSync.error.destinationNeedsPreparation';
        case 'git_selection_unavailable':
            return 'workspaceSync.error.gitPreparationFailed';
        case 'authorization_expired':
        case 'grant_expired':
            return 'workspaceSync.error.authorizationExpired';
        case 'root_changed':
        case 'root_not_authorized':
            return 'workspaceSync.error.rootNoLongerAuthorized';
        case 'conflict_changed':
            return 'workspaceSync.error.conflictNeedsAttention';
        default:
            return 'workspaceSync.error.needsAttention';
    }
}

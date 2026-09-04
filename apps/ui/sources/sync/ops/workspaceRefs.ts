import { getStorage } from '@/sync/domains/state/storageStore';
import {
    applyWorkspaceRefMutationToAccountSettings,
    type WorkspaceRefAccountMutation,
    type WorkspaceRefAccountMutationResult,
    type WorkspaceRefAccountRemovalResult,
} from '@/sync/domains/workspaces/workspaceRefs';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';

type WorkspaceRefAccountSettingsFailure =
    | Readonly<{ ok: false; code: 'workspace_settings_unavailable' }>
    | Readonly<{ ok: false; code: 'workspace_settings_changed' }>
    | Readonly<{ ok: false; code: 'workspace_settings_outcome_unknown' }>;

export type WorkspaceRefAccountSettingsMutationResult = WorkspaceRefAccountMutationResult
    | WorkspaceRefAccountSettingsFailure;

export type RemoveWorkspaceRefFromAccountResult = WorkspaceRefAccountRemovalResult
    | WorkspaceRefAccountSettingsFailure;

/**
 * Commits one field-level WorkspaceRef intent against one refreshed Account
 * Settings winner. A later winner is surfaced instead of replaying the intent.
 */
async function mutateWorkspaceRefsInAccount(
    mutation: WorkspaceRefAccountMutation,
): Promise<WorkspaceRefAccountSettingsMutationResult> {
    const sync = getSyncSingleton();
    const observedVersion = getStorage().getState().settingsVersion;
    if (observedVersion === null) {
        return { ok: false, code: 'workspace_settings_unavailable' };
    }

    await sync.refreshAccountSettingsFromServer(observedVersion);
    const expectedSettingsVersion = getStorage().getState().settingsVersion;
    if (expectedSettingsVersion === null) {
        return { ok: false, code: 'workspace_settings_unavailable' };
    }

    const result = await sync.mutateAccountSettingsOnce({
        expectedSettingsVersion,
        mutate: (raw) => applyWorkspaceRefMutationToAccountSettings(raw, mutation),
    });
    if (result.status === 'conflict') {
        return { ok: false, code: 'workspace_settings_changed' };
    }
    if (result.status === 'outcomeUnknown') {
        return { ok: false, code: 'workspace_settings_outcome_unknown' };
    }
    return result.value;
}

export async function addWorkspaceRefToAccount(
    input: Omit<Extract<WorkspaceRefAccountMutation, { kind: 'upsert' }>, 'kind'>,
): Promise<WorkspaceRefAccountSettingsMutationResult> {
    return await mutateWorkspaceRefsInAccount({ kind: 'upsert', ...input });
}

export async function renameWorkspaceRefInAccount(
    input: Readonly<{ serverId: string; workspaceRefId: string; label: string }>,
): Promise<WorkspaceRefAccountSettingsMutationResult> {
    return await mutateWorkspaceRefsInAccount({ kind: 'set_label', ...input });
}

export async function resetWorkspaceRefNameInAccount(
    input: Readonly<{ serverId: string; workspaceRefId: string }>,
): Promise<WorkspaceRefAccountSettingsMutationResult> {
    return await mutateWorkspaceRefsInAccount({ kind: 'set_label', ...input, label: null });
}

export async function migrateLegacyWorkspaceLabelInAccount(
    input: Omit<Extract<WorkspaceRefAccountMutation, { kind: 'migrate_label' }>, 'kind'>,
): Promise<WorkspaceRefAccountSettingsMutationResult> {
    return await mutateWorkspaceRefsInAccount({ kind: 'migrate_label', ...input });
}

export async function setWorkspaceRefPinnedInAccount(
    input: Readonly<{ serverId: string; workspaceRefId: string; pinned: boolean }>,
): Promise<WorkspaceRefAccountSettingsMutationResult> {
    return await mutateWorkspaceRefsInAccount({ kind: 'set_pinned', ...input });
}

export async function removeWorkspaceRefFromAccount(
    input: Readonly<{ serverId: string; workspaceRefId: string }>,
): Promise<RemoveWorkspaceRefFromAccountResult> {
    return await mutateWorkspaceRefsInAccount({ kind: 'remove', ...input });
}

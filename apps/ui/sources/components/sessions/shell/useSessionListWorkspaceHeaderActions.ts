import { Modal } from '@/modal';
import type { WorkspaceRefV1 } from '@/sync/domains/workspaces/workspaceRefModel';
import { findWorkspaceRefByScope } from '@/sync/domains/workspaces/workspaceRefs';
import { addWorkspaceRefToAccount, resetWorkspaceRefNameInAccount } from '@/sync/ops/workspaceRefs';
import { t } from '@/text';

export function useSessionListWorkspaceHeaderActions(input: Readonly<{
    workspaceRefs: ReadonlyArray<WorkspaceRefV1>;
    collapsedGroupKeys: Readonly<Record<string, boolean>>;
    setCollapsedGroupKeys: (value: Record<string, boolean>) => void;
}>) {
    return {
        handleRenameWorkspace: async (params: Readonly<{
            legacyWorkspaceKey: string;
            scopeHint: Readonly<{ serverId: string; machineId: string; rootPath: string }> | null;
            currentLabel: string;
        }>) => {
            if (!params.scopeHint) return;
            const newName = await Modal.prompt(
                t('sessionsList.renameWorkspacePromptTitle'),
                undefined,
                {
                    defaultValue: params.currentLabel,
                    placeholder: t('sessionsList.renameWorkspacePromptPlaceholder'),
                    confirmText: t('common.save'),
                    cancelText: t('common.cancel'),
                },
            );
            if (newName !== null && newName.trim()) {
                const currentRef = findWorkspaceRefByScope(input.workspaceRefs, params.scopeHint);
                if ((currentRef?.label ?? null) === newName.trim()) {
                    return;
                }
                const result = await addWorkspaceRefToAccount({
                    scope: params.scopeHint,
                    nowMs: Date.now(),
                    patch: { label: newName.trim() },
                });
                if (!result.ok) Modal.alert(t('common.error'), t('common.saveError'));
            }
        },
        handleResetWorkspaceName: async (params: Readonly<{
            legacyWorkspaceKey: string;
            scopeHint: Readonly<{ serverId: string; machineId: string; rootPath: string }> | null;
        }>) => {
            if (!params.scopeHint) return;
            const currentRef = findWorkspaceRefByScope(input.workspaceRefs, params.scopeHint);
            if ((currentRef?.label ?? null) === null) {
                return;
            }
            const result = await resetWorkspaceRefNameInAccount({
                serverId: params.scopeHint.serverId,
                workspaceRefId: currentRef!.id,
            });
            if (!result.ok) Modal.alert(t('common.error'), t('common.saveError'));
        },
        handleToggleCollapse: (collapseKey: string) => {
            const current = input.collapsedGroupKeys;
            if (current[collapseKey]) {
                input.setCollapsedGroupKeys({ ...current, [collapseKey]: false });
                return;
            }
            input.setCollapsedGroupKeys({ ...current, [collapseKey]: true });
        },
    };
}

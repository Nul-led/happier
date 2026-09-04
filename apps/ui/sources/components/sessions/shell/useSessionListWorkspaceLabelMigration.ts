import * as React from 'react';

import { migrateLegacyWorkspaceLabelInAccount } from '@/sync/ops/workspaceRefs';
import type { WorkspaceScopeBase } from '@/sync/domains/workspaces/workspaceScope';

export function useSessionListWorkspaceLabelMigration(input: Readonly<{
    workspaceLabels: Readonly<Record<string, string>>;
    scopeHintByLegacyWorkspaceKey: ReadonlyMap<string, WorkspaceScopeBase>;
}>) {
    React.useEffect(() => {
        const legacyWorkspaceLabels = input.workspaceLabels;
        const legacyKeys = Object.keys(legacyWorkspaceLabels);
        if (legacyKeys.length === 0) return;

        void (async () => {
            for (const [legacyKey, label] of Object.entries(legacyWorkspaceLabels)) {
                const scope = input.scopeHintByLegacyWorkspaceKey.get(legacyKey) ?? null;
                if (!scope || !label.trim()) continue;
                await migrateLegacyWorkspaceLabelInAccount({
                    scope,
                    legacyKey,
                    label,
                    nowMs: Date.now(),
                });
            }
        })();
    }, [
        input.scopeHintByLegacyWorkspaceKey,
        input.workspaceLabels,
    ]);
}

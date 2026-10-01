import * as React from 'react';

import { useRoleCatalog } from '@/components/roles/catalog/useRoleCatalog';
import { useRoleEnginePresentation } from '@/components/roles/catalog/useRoleEnginePresentation';
import { describeRolePurpose } from '@/sync/domains/roles/roleCatalog';

import type { RoleRailItem } from './rolesRailTypes';

/** The reader's enabled roles as rail rows, read when the rail opens. */
export function useRoleRailItems(): ReadonlyArray<RoleRailItem> {
    const catalog = useRoleCatalog();
    const presentEngine = useRoleEnginePresentation();
    return React.useMemo(() => catalog.entries
        .filter((entry) => entry.role.enabled)
        .map((entry) => {
            const engine = presentEngine(entry.role.engine);
            return {
                roleId: entry.roleId,
                name: entry.role.name,
                purpose: describeRolePurpose(entry.role),
                ...(engine.label ? { engineLabel: engine.label } : {}),
                ...(engine.icon ? { engineIcon: engine.icon } : {}),
                ...(entry.role.engine ? { agentTargetKey: entry.role.engine.agentTargetKey } : {}),
            };
        }), [catalog.entries, presentEngine]);
}

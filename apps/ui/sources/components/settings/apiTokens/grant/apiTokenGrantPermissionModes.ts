import * as React from 'react';
import type { SessionPermissionMode } from '@happier-dev/protocol';

import { getResolvedBackendCatalogEntries } from '@/agents/backendCatalog/getResolvedBackendCatalogEntries';
import { DEFAULT_AGENT_ID } from '@/agents/catalog/catalog';
import { getEnabledAgentIds } from '@/agents/catalog/enabled';
import type { AgentType } from '@/sync/domains/models/modelOptions';
import { getPermissionModeLabelForAgentType } from '@/sync/domains/permissions/permissionModeOptions';
import { useSetting } from '@/sync/store/hooks';
import { t } from '@/text';

/** The agent whose mode catalogue labels a grant: the creation binding's, else the default agent. */
export function useApiTokenGrantModeAgentType(agentTargetKey: string | null): AgentType {
    const acpCatalogSettingsV1 = useSetting('acpCatalogSettingsV1');
    const backendEnabledByTargetKey = useSetting('backendEnabledByTargetKey');
    return React.useMemo(() => {
        if (!agentTargetKey) return DEFAULT_AGENT_ID;
        const entry = getResolvedBackendCatalogEntries({
            enabledAgentIds: getEnabledAgentIds({ backendEnabledByTargetKey }),
            acpCatalogSettingsV1,
            backendEnabledByTargetKey,
        }).find((candidate) => candidate.backendTargetKey === agentTargetKey);
        return entry?.catalogAgentId ?? DEFAULT_AGENT_ID;
    }, [acpCatalogSettingsV1, agentTargetKey, backendEnabledByTargetKey]);
}

export function summarizeApiTokenGrantPermissionModes(modes: readonly SessionPermissionMode[] | null, agentType: AgentType): string {
    if (modes === null) return t('settingsEmbeds.capabilities.anyMode');
    if (modes.length === 1) return t('settingsEmbeds.capabilities.modeOnly', { name: getPermissionModeLabelForAgentType(agentType, modes[0]!) });
    return t('settingsEmbeds.capabilities.modes', { count: modes.length });
}

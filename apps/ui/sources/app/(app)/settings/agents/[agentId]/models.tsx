import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { AgentModelsScreen } from '@/components/settings/agents/AgentModelsScreen';
import { resolveAgentModelsTargetKey } from '@/agents/catalog/agentSettingsRoutes';

function one(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export function AgentModelsRoute() {
    const params = useLocalSearchParams<{
        agentId?: string | string[];
        pluginId?: string | string[];
        agentTargetKey?: string | string[];
        runtimeAgentId?: string | string[];
    }>();
    const agentId = one(params.agentId);
    return (
        <AgentModelsScreen
            agentTargetKey={resolveAgentModelsTargetKey({
                agentId,
                pluginId: one(params.pluginId),
                agentTargetKey: one(params.agentTargetKey),
            })}
            runtimeAgentId={one(params.runtimeAgentId) || agentId || null}
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { AgentModelsRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={AgentModelsRoute} />; }

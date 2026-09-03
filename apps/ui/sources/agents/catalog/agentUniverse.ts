import {
    getAllAgentCatalogDefinitions,
    type AgentId,
} from '@happier-dev/agents';
import { resolveBackendTargetKeyV2 } from '@/agents/backendCatalog/backendTargetKeyV2';

export function listAgentUniverseIds(): readonly AgentId[] {
    return getAllAgentCatalogDefinitions().map((definition) => definition.id);
}

export function buildAgentUniverseBackendTargetKey(id: string): string {
    const normalizedId = id.trim();
    return resolveBackendTargetKeyV2({
        kind: 'backend',
        backendId: normalizedId,
    });
}

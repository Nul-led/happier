import * as React from 'react';

import type { ResolvedAgentCatalogEntry } from '@/agents/backendCatalog/agentCatalogProjection';
import { resolveAgentCatalogProjection } from '@/agents/backendCatalog/agentCatalogProjection';
import { AgentCatalogIdentityIcon } from '@/agents/presentation/AgentCatalogIdentityIcon';

/**
 * An agent's brand mark on the agent-setup surfaces, through the catalog's identity owner (no tile
 * behind it). Callers that already hold the machine's resolved catalog pass its entry, so plugin agents
 * show their installed brand; otherwise the bundled catalog entry is used.
 */
export const MachineAgentMark = React.memo(function MachineAgentMark(props: Readonly<{
    agentId: string;
    entry?: ResolvedAgentCatalogEntry | null;
    machineId: string | null;
    serverId: string | null;
    size?: number;
}>) {
    const entry = React.useMemo(
        () => props.entry ?? resolveAgentCatalogProjection(props.agentId, { enabledAgentIds: [] }),
        [props.agentId, props.entry],
    );
    return (
        <AgentCatalogIdentityIcon
            entry={entry}
            machineId={props.machineId}
            serverId={props.serverId}
            current={props.entry != null}
            size={props.size ?? 20}
        />
    );
});

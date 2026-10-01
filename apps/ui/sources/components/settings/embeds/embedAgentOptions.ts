import type { MachineAgentsSnapshot } from '@/agents/machineAgents/useMachineAgents';

/**
 * The agents an embed's creation can bind on its computer: the account's enabled agents, narrowed to
 * the ones that computer reports installed (the machine agent inventory, the same installed facts the
 * Hub reads). Until the computer has reported, nothing is narrowed; agents the inventory does not
 * track (configured and plugin backends) stay; the bound agent always stays, so a stored choice is
 * shown rather than silently replaced.
 */
export function selectEmbedAgentOptions<TEntry extends Readonly<{ backendTargetKey: string; catalogAgentId: string | null }>>(
    entries: readonly TEntry[],
    inventory: Readonly<{ status: MachineAgentsSnapshot['status']; agents: readonly Readonly<{ agentId: string; installed: boolean }>[] }>,
    selectedAgentTargetKey: string | null,
): readonly TEntry[] {
    if (inventory.agents.length === 0) return entries;
    const installed = new Set(inventory.agents.filter((agent) => agent.installed).map((agent) => agent.agentId));
    return entries.filter((entry) => (
        entry.catalogAgentId === null
        || installed.has(entry.catalogAgentId)
        || entry.backendTargetKey === selectedAgentTargetKey
    ));
}

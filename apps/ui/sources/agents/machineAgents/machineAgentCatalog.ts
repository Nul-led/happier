import type { PluginProjectionV2 } from '@happier-dev/protocol';
import { buildMachineAgentInventoryDescriptors as buildProtocolMachineAgentInventoryDescriptors, type MachineAgentInventoryDescriptor } from '@happier-dev/protocol/capabilities';

export function buildMachineAgentInventoryDescriptors(inputs: Readonly<{
    pluginProjectionV2: Pick<PluginProjectionV2, 'agentsById'> | null;
}> | null): readonly MachineAgentInventoryDescriptor[] {
    return inputs?.pluginProjectionV2
        ? buildProtocolMachineAgentInventoryDescriptors(inputs.pluginProjectionV2)
        : [];
}

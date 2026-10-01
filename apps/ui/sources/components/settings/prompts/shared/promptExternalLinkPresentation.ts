import type { PromptExternalLinkEntryV1 } from '@happier-dev/protocol';
import { getMachineDisplayName } from '@/utils/sessions/machineDisplayNames';

type MachineEntry = Readonly<{
    id: string;
    metadata?: Readonly<{
        displayName?: string | null;
        host?: string | null;
    }> | null;
}>;

export function describePromptExternalLinkTitle(link: PromptExternalLinkEntryV1): string {
    if ('relativePath' in link.externalRef && typeof link.externalRef.relativePath === 'string') {
        return link.externalRef.relativePath;
    }
    if ('skillName' in link.externalRef && typeof link.externalRef.skillName === 'string') {
        return link.externalRef.skillName;
    }
    return link.assetTypeId;
}

export function describePromptExternalLinkSubtitle(args: Readonly<{
    link: PromptExternalLinkEntryV1;
    machines: readonly MachineEntry[];
    scopeLabel: string;
}>): string {
    const machine = args.machines.find((entry) => entry.id === args.link.machineId) ?? null;
    // A machine missing from the inventory has no name to show; its id is the only identity.
    const machineTitle = getMachineDisplayName(machine) ?? args.link.machineId;
    const workspacePath = typeof args.link.workspacePath === 'string' && args.link.workspacePath.length > 0
        ? args.link.workspacePath
        : null;
    return [machineTitle, args.scopeLabel, workspacePath].filter(Boolean).join(' · ');
}

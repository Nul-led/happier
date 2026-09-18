import type { WorkflowProjectTargetV1 } from '@happier-dev/protocol/workflows';

import { resolvePreferredMachineId } from '@/components/settings/pickers/resolvePreferredMachineId';
import type { Machine } from '@/sync/domains/state/storageTypes';

/**
 * The contextual Machine and project folder a new workflow draft starts with.
 *
 * UX §2.3: a neutral entry uses the canonical default resolver **only when it
 * produces a valid contextual choice**, and an unresolved target stays visibly
 * unresolved. So this returns `null` rather than half a target: a Machine with
 * no known folder is not a workable default, and inventing one would make the
 * screen look complete while Run now still could not proceed.
 *
 * Both halves come from the owners ordinary Session authoring already uses —
 * `resolvePreferredMachineId` and the Account's recent machine paths — so a
 * workflow and a new Session opened side by side agree about "where".
 */

type RecentMachinePath = Readonly<{ machineId?: string | null; path?: string | null }>;

export function resolveContextualWorkflowProjectTarget(params: Readonly<{
    machines: readonly Machine[];
    recentMachinePaths: readonly RecentMachinePath[];
    /** A captured Session's machine, when the draft was opened from one. */
    preferredMachineId?: string | null;
}>): WorkflowProjectTargetV1 | null {
    const machineId = resolvePreferredMachineId({
        machines: params.machines,
        recentMachinePaths: params.recentMachinePaths,
        preferredMachineId: params.preferredMachineId ?? null,
        onlineOnly: true,
    }) ?? resolvePreferredMachineId({
        machines: params.machines,
        recentMachinePaths: params.recentMachinePaths,
        preferredMachineId: params.preferredMachineId ?? null,
    });
    // A remembered machine the Account no longer lists is not a contextual
    // default: the resolver can still name it from recent paths, but this client
    // cannot resolve, reach or validate it.
    const machine = machineId === null
        ? undefined
        : params.machines.find((candidate) => candidate.id === machineId);
    if (!machineId || machine === undefined) return null;

    const recentDirectory = params.recentMachinePaths
        .find((entry) => entry?.machineId === machineId && typeof entry.path === 'string' && entry.path.trim().length > 0)
        ?.path;
    const homeDirectory = machine.metadata?.homeDir;
    const directory = (recentDirectory ?? homeDirectory ?? '').trim();
    if (directory.length === 0) return null;

    return { machineId, directory };
}

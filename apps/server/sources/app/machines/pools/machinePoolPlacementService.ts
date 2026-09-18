import { createHash } from "node:crypto";

/**
 * Selection input for one pool member. `enabled` is the saved definition bit; availability is
 * supplied separately by the caller's current presence observation so nothing here is persisted.
 */
export interface MachinePoolSelectableMemberV1 {
    machineId: string;
    priorityTier: number;
    enabled: boolean;
}

export interface MachinePoolSelectionV1 {
    machineId: string;
    priorityTier: number;
}

/**
 * Pure tier selection: the smallest numeric priority tier holding an enabled, currently available
 * member wins. Inside that tier the order is SHA-256 of the canonical JSON tuple
 * `[requestKey, machineId]`, with the Machine ID as the tie-break, so the same request key and
 * candidate set always resolve identically regardless of member order while independent request
 * keys spread across equal-tier Machines. This is not least-load, round-robin or a fairness
 * guarantee, and it records nothing: no ranking, request key or result is persisted.
 */
export function selectMachinePoolCandidate(input: Readonly<{
    members: readonly Readonly<MachinePoolSelectableMemberV1>[];
    availableMachineIds: ReadonlySet<string>;
    requestKey: string;
}>): MachinePoolSelectionV1 | null {
    const eligible = input.members.filter((member) => member.enabled && input.availableMachineIds.has(member.machineId));
    if (eligible.length === 0) {
        return null;
    }

    const priorityTier = eligible.reduce((lowest, member) => (member.priorityTier < lowest ? member.priorityTier : lowest), eligible[0].priorityTier);

    let selected: Readonly<MachinePoolSelectableMemberV1> | null = null;
    let selectedOrder = "";
    for (const member of eligible) {
        if (member.priorityTier !== priorityTier) {
            continue;
        }
        const order = createHash("sha256").update(JSON.stringify([input.requestKey, member.machineId])).digest("hex");
        const wins = selected === null
            || order < selectedOrder
            || (order === selectedOrder && member.machineId < selected.machineId);
        if (wins) {
            selected = member;
            selectedOrder = order;
        }
    }

    return selected === null ? null : { machineId: selected.machineId, priorityTier };
}

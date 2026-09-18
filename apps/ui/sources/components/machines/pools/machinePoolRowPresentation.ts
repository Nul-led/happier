import type { MachinePoolViewV1 } from '@happier-dev/protocol';

/** The only Machine facts a Pool row needs: an identity plus whatever readable label exists. */
export type MachinePoolRowMachine = Readonly<{
    id: string;
    metadata?: Readonly<{ displayName?: string | null; host?: string | null }> | null;
}>;

const IDENTITY_HINT_LENGTH = 8;

function resolveMachinePoolIdentityHint(
    poolId: string,
    otherCollidingPoolIds: readonly string[],
): string {
    const initialLength = Math.min(IDENTITY_HINT_LENGTH, poolId.length);
    for (let length = initialLength; length < poolId.length; length += 1) {
        const prefix = poolId.slice(0, length);
        if (otherCollidingPoolIds.every((candidate) => !candidate.startsWith(prefix))) {
            return prefix;
        }
    }
    return poolId;
}

/**
 * The Pool corridor's one readable-Machine label rule. A Home-local member whose decrypted label has
 * not arrived shows a short honest identifier rather than borrowing another Home's Machine name.
 */
export function resolveMachinePoolMemberLabel(
    machineId: string,
    machines: ReadonlyArray<MachinePoolRowMachine>,
): string {
    const machine = machines.find((candidate) => candidate.id === machineId);
    return machine?.metadata?.displayName || machine?.metadata?.host || machineId.slice(0, IDENTITY_HINT_LENGTH);
}

/**
 * The shared enabled-member label projection used by every Pool row. Presentation-specific limits
 * are applied only after disabled members have been removed, so a compact row cannot hide later
 * enabled members merely because disabled configuration entries appear first.
 */
export function resolveMachinePoolEnabledMemberLabels(
    view: MachinePoolViewV1,
    machines: ReadonlyArray<MachinePoolRowMachine>,
    options?: Readonly<{ limit?: number }>,
): readonly string[] {
    const enabledMembers = view.pool.members.filter((member) => member.enabled);
    const visibleMembers = options?.limit === undefined
        ? enabledMembers
        : enabledMembers.slice(0, options.limit);
    return visibleMembers.map((member) => resolveMachinePoolMemberLabel(member.machineId, machines));
}

export type MachinePoolRowPresentation = Readonly<{
    view: MachinePoolViewV1;
    memberPreview: string;
    identityDetail: string | null;
    accessibilityName: string;
}>;

/**
 * Pools intentionally allow duplicate names. Member context normally distinguishes them; when it
 * does not, the opaque identity is exposed so sighted and assistive-technology users can select
 * the same exact Pool without inventing a uniqueness rule.
 */
export function buildMachinePoolRowPresentations(
    pools: readonly MachinePoolViewV1[],
    memberPreview: (view: MachinePoolViewV1) => string,
): readonly MachinePoolRowPresentation[] {
    const previews = pools.map(memberPreview);
    return pools.map((view, index) => {
        const preview = previews[index] ?? '';
        const otherCollidingPoolIds = pools.flatMap((candidate, candidateIndex) => candidateIndex !== index
            && candidate.pool.name === view.pool.name
            && previews[candidateIndex] === preview
            ? [candidate.pool.id]
            : []);
        const needsIdentity = otherCollidingPoolIds.length > 0;
        return {
            view,
            memberPreview: preview,
            identityDetail: needsIdentity
                ? resolveMachinePoolIdentityHint(view.pool.id, otherCollidingPoolIds)
                : null,
            accessibilityName: needsIdentity ? `${view.pool.name}. ${view.pool.id}` : view.pool.name,
        };
    });
}

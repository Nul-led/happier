import type { MachinePoolViewV1 } from '@happier-dev/protocol';

import type { Machine } from '@/sync/domains/state/storageTypes';
import type { MachinePoolListStatus } from '@/sync/store/domains/machinePools';
import type { MachinePoolFeatureStatus } from '@/sync/engine/machines/useMachinePoolProjections';
import type { TemporaryComputerDestinationProjectionState } from '@/components/sessions/new/hooks/useTemporaryComputerAvailability';

import {
    buildMachineSelectionBuckets,
    type MachineSelectionFavoriteGroupPlacement,
} from './buildMachineSelectionBuckets';
import { resolveMachinePickerPresence } from '../resolveMachinePickerPresence';

/**
 * The Home-currentness facts a Pool group carries from the canonical projection owner. They are
 * structural on purpose: the presentation host and this destination owner must read the same values
 * rather than each re-deriving Pool currentness from rows or a failed resolve.
 */
type MachinePoolGroupCurrentness = Readonly<{
    serverId: string;
    pools: ReadonlyArray<MachinePoolViewV1>;
    featureStatus?: MachinePoolFeatureStatus;
    status?: MachinePoolListStatus;
    projectionReady?: boolean;
}>;

type MachineGroupCurrentness = Readonly<{
    loading: boolean;
    signedOut: boolean;
    error?: boolean;
}>;

/**
 * The minimum a Home group must expose to be counted. Structural on purpose so route, Simple and
 * Wizard hosts can feed their existing group shapes without casting.
 */
type DestinationHomeGroup = MachineGroupCurrentness & Readonly<{
    serverId: string;
    machines: ReadonlyArray<Machine>;
}>;

/**
 * Why a visible Pool row cannot be activated right now.
 *
 * Every reason is a Home-currentness fact. A cached zero-connected summary is deliberately absent:
 * only the authoritative resolve can learn that a member reconnected without any `machinePool`
 * mutation, so a stale count must never become permanent admission denial.
 */
export type MachinePoolRowUnavailableReason =
    | 'homeLoading'
    | 'homeSignedOut'
    | 'homeFailed'
    | 'poolsLoading'
    | 'poolsSignedOut'
    | 'poolsFailed';

/** The one rule for whether a rendered Pool row may invoke the read-only resolve. `null` = it may. */
export function resolveMachinePoolRowUnavailableReason(params: Readonly<{
    group?: MachineGroupCurrentness | null;
    poolGroup: MachinePoolGroupCurrentness;
}>): MachinePoolRowUnavailableReason | null {
    if (params.group?.signedOut) return 'homeSignedOut';
    if (params.group?.error) return 'homeFailed';
    if (params.group?.loading) return 'homeLoading';
    switch (params.poolGroup.status) {
        case 'signedOut': return 'poolsSignedOut';
        case 'error': return 'poolsFailed';
        case 'loading': return 'poolsLoading';
        default: break;
    }
    if (params.poolGroup.projectionReady === false) return 'poolsLoading';
    return null;
}

export type MachineDestinationModel = Readonly<{
    /** Every destination row the picker renders across Machines, Pools and Temporary computers. */
    destinationRowCount: number;
    machineRowCount: number;
    poolRowCount: number;
    temporaryComputerRowCount: number;
    /**
     * Every scoped Home settled its Machine list and Pool answer, and Temporary-computer
     * availability is known. Until then the rendered choice set is incomplete and no automatic
     * single-destination shortcut may be taken.
     */
    destinationSetSettled: boolean;
    /**
     * The only destination a user could pick, and only when the complete choice set holds exactly
     * one admissible row. `null` whenever the set is unsettled, larger, or not selectable.
     */
    soleSelectableDestination: Readonly<{ serverId: string; machine: Machine }> | null;
}>;

export type BuildMachineDestinationModelParams = Readonly<{
    groups: ReadonlyArray<DestinationHomeGroup>;
    poolGroups?: ReadonlyArray<MachinePoolGroupCurrentness>;
    temporaryComputerProjection?: Readonly<{
        state: TemporaryComputerDestinationProjectionState;
        rowCount: number;
    }>;
    recentMachines?: ReadonlyArray<Machine>;
    favoriteMachines?: ReadonlyArray<Machine>;
    showFavorites?: boolean;
    showRecent?: boolean;
    favoriteGroupPlacement?: MachineSelectionFavoriteGroupPlacement;
}>;

/**
 * The one owner of *how many* destinations the New Session picker offers and whether that set is
 * complete.
 *
 * `useMachineSelectionListModel` renders those rows, the route picker decides its single-destination
 * shortcut from them, and the Wizard derives its adaptive presentation from them. Keeping the count
 * here is what stops a Machine-only visibility predicate from disagreeing with the list the user
 * actually sees once Pools, Temporary computers or a non-current Home are involved.
 */
export function buildMachineDestinationModel(
    params: BuildMachineDestinationModelParams,
): MachineDestinationModel {
    const poolGroups = params.poolGroups ?? [];
    const poolProjectionIsPartOfDestinationSet = params.poolGroups !== undefined;
    // Mirrors the list model's presentation switch so the count can never describe a different list.
    const useBuckets = params.groups.length === 1
        && !params.groups[0]!.loading
        && !params.groups[0]!.signedOut;

    let machineRowCount = 0;
    let poolRowCount = 0;
    let selectableDestination: Readonly<{ serverId: string; machine: Machine }> | null = null;
    let selectableMachineCount = 0;
    let destinationSetSettled = params.temporaryComputerProjection?.state !== 'pending';

    for (const group of params.groups) {
        const poolGroup = poolGroups.find((candidate) => candidate.serverId === group.serverId);
        poolRowCount += poolGroup?.pools.length ?? 0;
        if (
            group.loading
            || group.error
            || (poolProjectionIsPartOfDestinationSet && !poolGroup)
            || (poolGroup && resolveMachinePoolRowUnavailableReason({ group, poolGroup }) !== null)
        ) {
            destinationSetSettled = false;
        }
        if (group.loading || group.signedOut) continue;

        const machineRows: ReadonlyArray<Machine> = useBuckets
            ? buildMachineSelectionBuckets({
                machines: group.machines,
                recentMachines: params.recentMachines,
                favoriteMachines: params.favoriteMachines,
                showFavorites: params.showFavorites,
                showRecent: params.showRecent,
                disableOfflineMachines: true,
                favoriteGroupPlacement: params.favoriteGroupPlacement,
            }).buckets.flatMap((bucket) => bucket.machines)
            : group.machines;

        machineRowCount += machineRows.length;
        for (const row of machineRows) {
            if (!resolveMachinePickerPresence(row).selectable) continue;
            selectableMachineCount += 1;
            // Recent/favorite rows can be plain Machine records, so the Home-qualified candidate is
            // resolved from this group's own list instead of trusting the rendered row's shape.
            const owned = group.machines.find((candidate) => candidate.id === row.id);
            selectableDestination = owned ? { serverId: group.serverId, machine: owned } : null;
        }
    }

    const temporaryComputerRowCount = params.temporaryComputerProjection?.state === 'available'
        ? params.temporaryComputerProjection.rowCount
        : 0;
    const destinationRowCount = machineRowCount + poolRowCount + temporaryComputerRowCount;
    return {
        destinationRowCount,
        machineRowCount,
        poolRowCount,
        temporaryComputerRowCount,
        destinationSetSettled,
        soleSelectableDestination: destinationSetSettled
            && destinationRowCount === 1
            && selectableMachineCount === 1
            ? selectableDestination
            : null,
    };
}

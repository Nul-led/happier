import type { ActiveSelectionMachineGroup } from '../hooks/useActiveSelectionMachineGroups';
import { describeMachinePresenceLine } from '@/utils/sessions/machinePresenceLine';
import { describeMachineLockedReason, getMachineDisplayName, resolveMachineDisplayNames } from '@/utils/sessions/machineDisplayNames';
import { formatOSPlatform } from '@/utils/sessions/sessionUtils';
import { resolveHappierCollectionInitialKey } from '@happier-dev/plugin-ui/presentation';

export const MACHINES_COLLECTION_ROOT = '/settings/machines';
export const MACHINES_THIS_COMPUTER_ROUTE = '/settings/machines/this-computer';
export const MACHINES_ADD_ROUTE = '/settings/machines/add';

/** The ways the add-a-machine form offers (`useMachineAddPaths` decides which this device can run). */
export type MachineAddRoutePath = 'thisComputer' | 'ssh' | 'anotherComputer';

/**
 * Add a machine: the Machines collection's draft (lab `add-flows` M4). `path` opens that way first when
 * this device offers it — "set up this computer" entry points ask for `thisComputer`.
 */
export function buildMachineAddHref(options: Readonly<{ path?: MachineAddRoutePath }> = {}): string {
    return options.path ? `${MACHINES_ADD_ROUTE}?path=${encodeURIComponent(options.path)}` : MACHINES_ADD_ROUTE;
}

export type MachineCollectionRow = Readonly<{
    machineId: string;
    serverId: string;
    /** The name the user gave the machine, else its host; told apart when two share it. */
    title: string;
    /** The host, when the title is a different display name. */
    host: string | null;
    platformLabel: string;
    online: boolean;
    /** "Online", or "Offline · last seen …", from the shared presence owner. */
    presence: string;
    /** Why this device cannot read the machine, when it is locked. */
    reason: string | null;
}>;

export type MachineCollectionSection = Readonly<{
    serverId: string;
    /** The Home's name when several Homes are listed; `null` for the single, ungrouped list. */
    title: string | null;
    status: ActiveSelectionMachineGroup['status'];
    rows: readonly MachineCollectionRow[];
}>;

export type MachineCollection = Readonly<{
    count: number;
    sections: readonly MachineCollectionSection[];
}>;

/**
 * The machines of the Homes the app shows, as the collection lists them: one list for a single
 * Home, one section per Home otherwise (a Home without machines keeps its section and its status),
 * each sorted by the name the user sees.
 */
export function buildMachineCollection(input: Readonly<{
    groups: readonly ActiveSelectionMachineGroup[];
    groupedByHome: boolean;
    query?: string;
    nowMs?: number;
}>): MachineCollection {
    const query = input.query?.trim().toLocaleLowerCase() ?? '';
    const nowMs = input.nowMs ?? Date.now();
    let count = 0;
    const sections = input.groups.map((group): MachineCollectionSection => {
        const names = resolveMachineDisplayNames(group.machines);
        const rows = group.machines
            .map((machine): MachineCollectionRow => {
                const host = machine.metadata?.host?.trim() || null;
                const name = getMachineDisplayName(machine) ?? machine.id;
                const presence = describeMachinePresenceLine(machine, nowMs);
                return {
                    machineId: machine.id,
                    serverId: group.serverId,
                    title: names.get(machine.id) ?? name,
                    host: host && host !== name ? host : null,
                    platformLabel: formatOSPlatform(machine.metadata?.platform),
                    online: presence.online,
                    presence: presence.label,
                    reason: describeMachineLockedReason(machine),
                };
            })
            .filter((row) => !query
                || row.title.toLocaleLowerCase().includes(query)
                || (row.host?.toLocaleLowerCase().includes(query) ?? false))
            .sort((a, b) => a.title.localeCompare(b.title) || a.machineId.localeCompare(b.machineId));
        count += rows.length;
        return {
            serverId: group.serverId,
            title: input.groupedByHome ? group.serverName : null,
            status: group.status,
            rows,
        };
    });
    return { count, sections };
}

/** A machine's detail inside the collection, scoped to the Home it belongs to. */
export function machineCollectionHref(row: Readonly<{ machineId: string; serverId: string }>): string {
    return `${MACHINES_COLLECTION_ROOT}/${encodeURIComponent(row.machineId)}?serverId=${encodeURIComponent(row.serverId)}`;
}

/** A machine pool's detail inside the collection, scoped to the Home it belongs to. */
export function machinePoolCollectionHref(pool: Readonly<{ poolId: string; serverId: string }>): string {
    return `${MACHINES_COLLECTION_ROOT}/pools/${encodeURIComponent(pool.poolId)}?serverId=${encodeURIComponent(pool.serverId)}`;
}

/**
 * Where a wide collection lands when its route names nothing: the machine last opened, the first
 * machine, this computer (desktop), or adding a machine.
 */
export function resolveMachineCollectionLandingHref(input: Readonly<{
    collection: MachineCollection;
    lastVisited: Readonly<{ machineId: string; serverId: string }> | null;
    isDesktop: boolean;
}>): string {
    const rows = input.collection.sections.flatMap((section) => section.rows);
    const keyOf = (machine: Readonly<{ machineId: string; serverId: string }>) => JSON.stringify([machine.serverId, machine.machineId]);
    const landingKey = resolveHappierCollectionInitialKey({
        keys: rows.map(keyOf),
        lastVisited: input.lastVisited ? keyOf(input.lastVisited) : null,
    });
    const landing = rows.find((row) => keyOf(row) === landingKey);
    if (landing) return machineCollectionHref(landing);
    return input.isDesktop ? MACHINES_THIS_COMPUTER_ROUTE : MACHINES_ADD_ROUTE;
}

/**
 * The collection row the route selects: `machine:<serverId>:<id>` (the Home may be absent),
 * `thisComputer`, `pool:<serverId>:<poolId>`, `poolDraft:<serverId>` for a pool being added, or
 * `machineDraft` for the machine being added.
 */
export function resolveSelectedMachineCollectionKey(
    pathname: string,
    params: Readonly<{ serverId?: string | null }>,
): string | null {
    const normalized = pathname.replace(/\/+$/, '');
    if (!normalized.startsWith(`${MACHINES_COLLECTION_ROOT}/`)) return null;
    const segments = normalized.slice(MACHINES_COLLECTION_ROOT.length + 1).split('/').map(decodeSegment);
    const serverId = params.serverId?.trim() ?? '';
    if (segments[0] === 'pools') {
        if (segments[1] === 'new') return `poolDraft:${serverId}`;
        return segments[1] ? `pool:${serverId}:${segments[1]}` : null;
    }
    if (segments.length !== 1 || !segments[0]) return null;
    if (segments[0] === 'this-computer') return 'thisComputer';
    if (segments[0] === 'add') return 'machineDraft';
    return `machine:${serverId}:${segments[0]}`;
}

export function machineCollectionRowKey(row: Readonly<{ machineId: string; serverId: string }>): string {
    return `machine:${row.serverId}:${row.machineId}`;
}

/** A route without a Home selects the machine by id alone. */
export function isMachineCollectionRowSelected(selectedKey: string | null, row: Readonly<{ machineId: string; serverId: string }>): boolean {
    return selectedKey === machineCollectionRowKey(row) || selectedKey === `machine::${row.machineId}`;
}

function decodeSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

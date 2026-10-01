import {
    resolveCurrentAppDestination,
    selectAppDestinationsInPlacement,
    type BuiltinAppShellColumnId,
    type CompactAppDestination,
} from '@/components/appShell/destinations/compactAppDestinationCatalog';

/**
 * The desktop app shell (lab `xrail-R1`, user ruling 2026-09-27): a rail of destinations, a column that
 * belongs to the open destination, then the page. Every fact here is a projection of the one
 * destination catalog (`compactAppDestinationCatalog`): its placements say what the rail lists, and
 * its current destination says which entry is open and which column stands beside the page.
 */

/** What the second column shows beside the page. `none`: the destination is a full page. */
export type AppShellColumn =
    | Readonly<{ kind: 'builtin'; id: BuiltinAppShellColumnId }>
    /** A plugin page's own column, rendered by the plugin (`PluginAppPageColumn`). */
    | Readonly<{ kind: 'plugin'; destinationId: string }>
    | Readonly<{ kind: 'none' }>;

/** A column that is shown (not `none`). */
export type AppShellShownColumn = Exclude<AppShellColumn, Readonly<{ kind: 'none' }>>;

const NO_COLUMN: AppShellColumn = Object.freeze({ kind: 'none' });
const BUILTIN_COLUMNS: Readonly<Record<BuiltinAppShellColumnId, Extract<AppShellColumn, { kind: 'builtin' }>>> = {
    sessions: Object.freeze({ kind: 'builtin', id: 'sessions' }),
    projects: Object.freeze({ kind: 'builtin', id: 'projects' }),
    workflows: Object.freeze({ kind: 'builtin', id: 'workflows' }),
    boards: Object.freeze({ kind: 'builtin', id: 'boards' }),
    plugins: Object.freeze({ kind: 'builtin', id: 'plugins' }),
    settings: Object.freeze({ kind: 'builtin', id: 'settings' }),
};

const PLUGIN_COLUMNS = new Map<string, Extract<AppShellColumn, { kind: 'plugin' }>>();

/** The (referentially stable) model of a plugin page's own column. */
function pluginAppShellColumn(destinationId: string): Extract<AppShellColumn, { kind: 'plugin' }> {
    let column = PLUGIN_COLUMNS.get(destinationId);
    if (!column) {
        column = Object.freeze({ kind: 'plugin', destinationId });
        PLUGIN_COLUMNS.set(destinationId, column);
    }
    return column;
}

/** The (referentially stable) model of a built-in column. */
export function builtinAppShellColumn(id: BuiltinAppShellColumnId): Extract<AppShellColumn, { kind: 'builtin' }> {
    return BUILTIN_COLUMNS[id];
}

/** A rail entry is a catalog destination placed on the rail. */
export type AppRailEntry = CompactAppDestination;

export type AppRailEntries = Readonly<{
    /** The app's own destinations: Sessions, Search, Inbox, Projects, Workflows… */
    app: readonly AppRailEntry[];
    /** Plugins and every plugin destination placed on the rail (or whose column this host lacks). */
    plugins: readonly AppRailEntry[];
    /** The bottom of the rail: Settings. */
    account: readonly AppRailEntry[];
}>;

/** The rail's entries, per region, in catalog order. Column destinations and hidden ones stay off. */
export function buildAppRailEntries(catalog: readonly CompactAppDestination[]): AppRailEntries {
    return {
        app: selectAppDestinationsInPlacement(catalog, { kind: 'rail', region: 'app' }),
        plugins: selectAppDestinationsInPlacement(catalog, { kind: 'rail', region: 'plugins' }),
        account: selectAppDestinationsInPlacement(catalog, { kind: 'rail', region: 'account' }),
    };
}

/**
 * Which plugin entries fit in the rail's measured room (`slots` entry heights) and which go into
 * "More". "More" takes the last slot, so it appears only when something does not fit, and the
 * Plugins page (the region's first entry) is the last to give way. Unmeasured: everything shows.
 */
export function splitAppRailOverflow(
    entries: readonly AppRailEntry[],
    slots: number | null,
): Readonly<{ shown: readonly AppRailEntry[]; overflow: readonly AppRailEntry[] }> {
    if (slots === null || !Number.isFinite(slots) || entries.length <= slots) return { shown: entries, overflow: [] };
    const keep = Math.max(0, Math.floor(slots) - 1);
    return { shown: entries.slice(0, keep), overflow: entries.slice(keep) };
}

/** The column a destination stands beside its own page (a peek from its rail icon shows it); `null` for a full page. */
export function resolveAppRailEntryColumn(entry: AppRailEntry): AppShellShownColumn | null {
    if (entry.kind === 'builtin') return entry.column !== undefined ? builtinAppShellColumn(entry.column) : null;
    return entry.ownColumn ? pluginAppShellColumn(entry.id) : null;
}

export type AppShellLocation = Readonly<{
    /** The open destination. */
    current: CompactAppDestination | null;
    /** The rail entry that is open: the current destination, or the owner of the column it is placed in. */
    railEntryId: string | null;
    /** The column beside the page. */
    column: AppShellColumn;
}>;

/** The shell's one answer to "where am I": everything the rail, the column and the peek show. */
export function resolveAppShellLocation(
    catalog: readonly CompactAppDestination[],
    pathname: string,
): AppShellLocation {
    const current = resolveCurrentAppDestination(catalog, pathname);
    if (current === null) return { current: null, railEntryId: null, column: NO_COLUMN };
    if (current.placement.kind === 'column') {
        const columnId = current.placement.column;
        const owner = catalog.find((destination) => destination.kind === 'builtin' && destination.column === columnId);
        return { current, railEntryId: owner?.id ?? null, column: builtinAppShellColumn(columnId) };
    }
    return { current, railEntryId: current.id, column: resolveAppRailEntryColumn(current) ?? NO_COLUMN };
}

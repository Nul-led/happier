import type { CompactAppDestination, DestinationRef } from '../destinations/compactAppDestinationCatalog';
import { pruneWorkspaceTabPairs, type SharedWorkspaceTabs } from './workspaceSyncedTabs';

export function workspaceSingletonDestinationIds(catalog: readonly CompactAppDestination[]): readonly string[] {
    return catalog.filter(item => item.kind === 'plugin' && item.container === 'appPage').map(item => item.id);
}

export function isWorkspaceSingletonDestination(catalog: readonly CompactAppDestination[], target: DestinationRef): boolean {
    return workspaceSingletonDestinationIds(catalog).includes(target.kind);
}

/** Navigation admission and portable CAS rebase share one catalog-owned singleton policy. */
export function normalizeWorkspaceSingletonTabs(record: SharedWorkspaceTabs, catalog: readonly CompactAppDestination[]): SharedWorkspaceTabs {
    const firstByKind = new Map<string, string>();
    const singletonKinds = new Set(workspaceSingletonDestinationIds(catalog));
    const retiredIds = new Map<string, string>();
    const tabsById = { ...record.tabsById };
    const order: string[] = [];
    let changed = false;
    for (const id of record.order) {
        const tab = record.tabsById[id];
        const singleton = singletonKinds.has(tab.target.kind);
        const first = singleton ? firstByKind.get(tab.target.kind) : undefined;
        if (first) {
            tabsById[first] = { ...tab, id: first };
            delete tabsById[id];
            retiredIds.set(id, first);
            changed = true;
        } else {
            if (singleton) firstByKind.set(tab.target.kind, id);
            order.push(id);
        }
    }
    if (!changed) return record;
    const pairs = pruneWorkspaceTabPairs(record.pairs.map(pair => pair.map(id => retiredIds.get(id) ?? id)), tabsById);
    return { ...record, tabsById, order, pairs };
}

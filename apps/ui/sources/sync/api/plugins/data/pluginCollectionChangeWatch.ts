import { PluginDomainChangeEntrySchema } from '@happier-dev/protocol/changes';

import {
    captureActiveServerAccountScopeLifetime,
    type ActiveServerAccountScopeLifetime,
} from '@/sync/domains/scope/activeServerAccountScope';

export type PluginCollectionChangeWatchV1 = Readonly<{ dispose(): void }>;

export type WatchActivePluginCollectionChangesInput = Readonly<{
    pluginId: string;
    collectionId: string;
    onInvalidated(): void;
    accountLifetime?: ActiveServerAccountScopeLifetime;
}>;

type ActivePluginCollectionChangeWatch = Readonly<{
    pluginId: string;
    collectionId: string;
    lifetime: ActiveServerAccountScopeLifetime;
    onInvalidated: () => void;
}>;

const activeWatches = new Set<ActivePluginCollectionChangeWatch>();

export function registerActivePluginCollectionChangeWatch(input: Readonly<{
    pluginId: string;
    collectionId: string;
    lifetime: ActiveServerAccountScopeLifetime;
    onInvalidated(): void;
}>): PluginCollectionChangeWatchV1 {
    const watch: ActivePluginCollectionChangeWatch = Object.freeze({ ...input });
    let disposed = false;
    let retirement: Readonly<{ dispose(): void }> | null = null;
    const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        activeWatches.delete(watch);
        retirement?.dispose();
        retirement = null;
    };
    activeWatches.add(watch);
    retirement = input.lifetime.onRetire(dispose);
    if (!input.lifetime.isCurrent()) dispose();
    return Object.freeze({ dispose });
}

function notifyWatches(watches: Iterable<ActivePluginCollectionChangeWatch>): void {
    for (const watch of watches) {
        if (!activeWatches.has(watch) || !watch.lifetime.isCurrent()) continue;
        try {
            watch.onInvalidated();
        } catch {
            // Presentation callbacks cannot affect canonical Account changes.
        }
    }
}

export function watchActivePluginCollectionChanges(
    input: WatchActivePluginCollectionChangesInput,
): PluginCollectionChangeWatchV1 | null {
    const lifetime = input.accountLifetime ?? captureActiveServerAccountScopeLifetime();
    if (!lifetime || !lifetime.isCurrent()) return null;
    return registerActivePluginCollectionChangeWatch({ ...input, lifetime });
}

export function publishActivePluginCollectionChanges(changes: readonly unknown[]): void {
    const affected = new Set<ActivePluginCollectionChangeWatch>();
    for (const rawChange of changes) {
        const parsed = PluginDomainChangeEntrySchema.safeParse(rawChange);
        if (!parsed.success || parsed.data.hint.pluginDomain !== 'dataCollection') continue;
        const { pluginId, collectionId } = parsed.data.hint;
        for (const watch of activeWatches) {
            if (watch.pluginId === pluginId && watch.collectionId === collectionId) affected.add(watch);
        }
    }
    notifyWatches(affected);
}

export function resetActivePluginCollectionChanges(): void {
    notifyWatches(activeWatches);
}

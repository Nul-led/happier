import * as React from 'react';

import {
    type LocalServiceLauncherSnapshotClient,
    type LocalServiceLauncherState,
    useLocalServiceLauncherStateController,
} from '@/sync/domains/local/services/launch';
import type { LocalServiceInventoryState } from '@/sync/domains/local/services/inventory/store';
import {
    type LocalServiceInventorySnapshotClient,
    useLocalServiceInventoryStateController,
} from '@/sync/domains/local/services/inventory/useLocalServiceInventoryState';

/**
 * The two daemon feeds a Local services surface reads — the inventory (pushed by the daemon's watch)
 * and the launcher (derived from it) — kept fresh together by one freshness rule. Mount it only in an
 * open Local services surface: it starts machine reads and a daemon watch.
 */
export type LocalServiceLiveFeedsInput = Readonly<{
    machineId: string | null;
    serverId: string | null;
    sessionId?: string;
    workspaceRoot?: string | null;
    scope: 'workspace' | 'machine';
    /** Supplied state replaces the live feed (tests, previews); `undefined` reads live. */
    inventoryState?: LocalServiceInventoryState;
    launcherState?: LocalServiceLauncherState | null;
    inventorySnapshotClient?: LocalServiceInventorySnapshotClient;
    launcherSnapshotClient?: LocalServiceLauncherSnapshotClient;
}>;

export type LocalServiceLiveFeeds = Readonly<{
    inventoryState: LocalServiceInventoryState;
    launcherState: LocalServiceLauncherState | null;
    /** Undefined when the inventory is supplied rather than live. */
    refresh: (() => void) | undefined;
    applyLauncherSnapshot: ReturnType<typeof useLocalServiceLauncherStateController>['applySnapshot'] | undefined;
}>;

export function useLocalServiceLiveFeeds(input: LocalServiceLiveFeedsInput): LocalServiceLiveFeeds {
    const liveInventory = useLocalServiceInventoryStateController({
        machineId: input.machineId,
        serverId: input.serverId,
        sessionId: input.sessionId,
        enabled: input.inventoryState === undefined,
        snapshotClient: input.inventorySnapshotClient,
    });
    const liveLauncher = useLocalServiceLauncherStateController({
        machineId: input.machineId,
        serverId: input.serverId,
        sessionId: input.sessionId,
        scope: input.scope,
        workspaceRoot: input.workspaceRoot ?? null,
        enabled: input.launcherState === undefined,
        snapshotClient: input.launcherSnapshotClient,
    });
    // The rows are built from the daemon's LAUNCHER feed, and inventory entries only enrich them —
    // so making the inventory fresh is not enough on its own for a service started after mount to
    // appear. The launcher feed is derived from the same inventory the daemon just rescanned, so it
    // needs no push producer of its own: one push source (the inventory watch) drives the derived
    // read. `generatedAt` advancing is exactly "the daemon rescanned".
    const inventorySupplied = input.inventoryState !== undefined;
    const inventoryGeneratedAt = liveInventory.state.generatedAt;
    const refreshLauncher = liveLauncher.refresh;
    const lastSyncedInventoryGeneratedAtRef = React.useRef<number | null>(null);
    React.useEffect(() => {
        if (inventorySupplied || inventoryGeneratedAt === null) {
            return;
        }
        if (lastSyncedInventoryGeneratedAtRef.current === inventoryGeneratedAt) {
            return;
        }
        const isFirstObservation = lastSyncedInventoryGeneratedAtRef.current === null;
        lastSyncedInventoryGeneratedAtRef.current = inventoryGeneratedAt;
        // The launcher's own mount read already covers the first snapshot; only a later change
        // needs a derived re-read.
        if (!isFirstObservation) {
            refreshLauncher?.();
        }
    }, [inventoryGeneratedAt, inventorySupplied, refreshLauncher]);

    // An explicit refresh re-reads both halves directly rather than relying on the derived chain:
    // an unchanged inventory would otherwise leave the launcher feed untouched, and a user who
    // pressed refresh is entitled to a real re-read of what they can see.
    const refreshInventory = liveInventory.refresh;
    const refresh = React.useMemo(() => {
        if (inventorySupplied || !refreshInventory) {
            return undefined;
        }
        return () => {
            refreshInventory();
            refreshLauncher?.();
        };
    }, [inventorySupplied, refreshInventory, refreshLauncher]);

    const inventoryState = input.inventoryState ?? liveInventory.state;
    const launcherState = input.launcherState !== undefined ? input.launcherState : liveLauncher.state;
    const applyLauncherSnapshot = input.launcherState === undefined ? liveLauncher.applySnapshot : undefined;
    return React.useMemo(() => ({
        inventoryState,
        launcherState,
        refresh,
        applyLauncherSnapshot,
    }), [applyLauncherSnapshot, inventoryState, launcherState, refresh]);
}

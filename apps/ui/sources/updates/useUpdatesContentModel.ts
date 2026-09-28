import * as React from 'react';
import { useRouter } from 'expo-router';

import { useReleaseNotesLauncher, useReleaseNotesUnread } from '@/changelog/releaseNotes';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { ensureMachineUpdateFactsBackground } from '@/capabilities/ensureAgentInstallablesBackground';
import { useActiveServerAccountScope, useAllMachines } from '@/sync/domains/state/storage';
import { isMachineOnline } from '@/utils/sessions/machineUtils';
import { storage } from '@/sync/domains/state/storageStore';
import { resolveSessionMachineId } from '@/sync/domains/session/directSessions/resolveSessionMachineId';

import { buildMachineUpdateGroups, readUpdatableInstallables, type UpdatesGroup } from './buildMachineUpdateGroups';
import { buildUpdatesSummary, planUpdateAll, type UpdatesSummary } from './items/buildUpdatesSummary';
import type { UpdateItem } from './items/updateItem';
import { useMachinesCapabilitySnapshots } from './machineCapabilitySnapshots';
import { markUpdateCompletionsSeen, refreshMachineUpdateFacts, runMachineItemUpdate, useMachineUpdateRuns, useUnseenUpdateCompletions } from './machineUpdateRuns';
import { useAppUpdateStatus } from './useAppUpdateStatus';
import { useThisComputerCliUpdate } from './useThisComputerCliUpdate';

export type { UpdatesGroup };

export type UpdateAllProgress = Readonly<{ done: number; total: number; stopping: boolean }>;

export type UpdatesContentModel = Readonly<{
    summary: UpdatesSummary;
    groups: readonly UpdatesGroup[];
    /** The newest check behind these rows: the app's own, or any machine's update facts. */
    checkedAt: number | null;
    /** Online machines whose tools have not all answered yet (the header's "not checked" line). */
    uncheckedMachineCount: number;
    /** Machines with sessions running now: their service-restarting rows say so, quietly. */
    sessionsRunningOn: ReadonlySet<string>;
    runItem: (item: UpdateItem) => Promise<void>;
    updateAll: () => Promise<void>;
    stopAfterCurrent: () => void;
    batch: UpdateAllProgress | null;
    checkNow: () => void;
    skipAppVersion: (() => void) | null;
    /** Release notes stay reachable from the This app group (R13 (e)). */
    openWhatsNew: () => void;
    whatsNewUnread: boolean;
}>;

/** The machines with an active session, as one stable key (the canonical session state). */
function selectSessionsRunningKey(state: ReturnType<typeof storage.getState>): string {
    const ids = new Set<string>();
    for (const session of Object.values(state.sessions)) {
        const machineId = session.active ? resolveSessionMachineId(session.metadata ?? null) : null;
        if (machineId) ids.add(machineId);
    }
    return [...ids].sort().join('\u0000');
}

/**
 * The Updates surface's detail model, mounted only while the popover or the screen is open
 * (`apps/ui/AGENTS.md`): it asks each online machine for its agent CLI and helper versions through
 * the machine capability cache's own freshness policy, lists every row in the fixed order
 * This app → This computer → other machines, and runs actions through their canonical executors.
 */
export function useUpdatesContentModel(): UpdatesContentModel {
    const router = useRouter();
    const app = useAppUpdateStatus();
    const appItem = app.model.item;
    const thisComputer = useThisComputerCliUpdate();
    const machines = useAllMachines();
    // One server scope for the rows, their facts, their runs and their refreshes.
    const serverId = useActiveServerSnapshot().serverId;
    const activeScope = useActiveServerAccountScope();
    const updateScope = activeScope?.serverId === serverId ? activeScope : null;
    const runs = useMachineUpdateRuns(serverId);
    const releaseNotes = useReleaseNotesUnread();
    const releaseNotesLauncher = useReleaseNotesLauncher();

    const installables = React.useMemo(readUpdatableInstallables, []);

    const onlineMachineIds = React.useMemo(() => {
        const ids = machines.filter((machine) => machine.id !== thisComputer.machineId && isMachineOnline(machine)).map((machine) => machine.id);
        if (thisComputer.machineId) ids.unshift(thisComputer.machineId);
        return ids;
    }, [machines, thisComputer.machineId]);
    const onlineKey = onlineMachineIds.join('\u0000');
    // Every machine's cached detect (offline ones keep their last-known rows); only online ones are asked.
    const machineIds = React.useMemo(() => machines.map((machine) => machine.id), [machines]);
    const snapshots = useMachinesCapabilitySnapshots(serverId, machineIds);
    // Opening the surface asks each online machine through the cache's existing freshness policy.
    React.useEffect(() => {
        void ensureMachineUpdateFactsBackground({ serverId, machineIds: onlineKey ? onlineKey.split('\u0000') : [] });
    }, [onlineKey, serverId]);

    const { groups, remotes, uncheckedMachineCount, factsCheckedAt } = React.useMemo(() => {
        const built = buildMachineUpdateGroups({
            machines,
            thisMachineId: thisComputer.machineId,
            thisComputerItem: thisComputer.item,
            runs,
            snapshots,
            installables,
        });
        const app: UpdatesGroup = { id: 'app', kind: 'app', machineName: null, machineId: null, online: true, items: [appItem] };
        return { groups: [app, ...built.groups], remotes: built.remotes, uncheckedMachineCount: built.uncheckedMachineCount, factsCheckedAt: built.checkedAt };
    }, [appItem, installables, machines, runs, snapshots, thisComputer.item, thisComputer.machineId]);

    const allItems = React.useMemo(() => groups.flatMap((group) => group.items), [groups]);
    // Open Updates shows every result, so the pill's "Updated" is seen; a completion that lands
    // while the surface stays open is seen too (its row says so).
    const completions = useUnseenUpdateCompletions(updateScope);
    React.useEffect(() => {
        markUpdateCompletionsSeen(updateScope);
    }, [completions, updateScope]);
    // The same coverage the always-mounted summary ranks with, so the open header never says
    // "Up to date" while the pill says some tools were not checked.
    const summary = React.useMemo(
        () => buildUpdatesSummary(allItems, new Map(), { uncheckedMachineCount }),
        [allItems, uncheckedMachineCount],
    );

    const lastUpdateSignatureByMachine = React.useMemo(
        () => new Map(remotes.map((remote) => [remote.machine.id, remote.lastUpdateSignature])),
        [remotes],
    );
    const executeItem = React.useCallback(async (item: UpdateItem) => {
        if (item.subject.kind === 'app') return app.run();
        if (item.subject.kind === 'happier-cli' && item.machineId === thisComputer.machineId) return thisComputer.run();
        const machineId = item.machineId;
        if (!machineId || !updateScope) return;
        await runMachineItemUpdate(item, { scope: updateScope, lastUpdateSignature: lastUpdateSignatureByMachine.get(machineId) });
    }, [app, lastUpdateSignatureByMachine, thisComputer, updateScope]);

    // Pressing Update (or Update all) is the consent: the row runs inline, with its progress in place.
    const runItem = React.useCallback(async (item: UpdateItem) => {
        if (item.action.kind !== 'run') return;
        await executeItem(item);
    }, [executeItem]);

    const [batch, setBatch] = React.useState<UpdateAllProgress | null>(null);
    const stopRef = React.useRef(false);
    const itemsRef = React.useRef(allItems);
    itemsRef.current = allItems;

    const updateAll = React.useCallback(async () => {
        if (batch) return;
        const plan = planUpdateAll(itemsRef.current);
        if (plan.total === 0) return;

        stopRef.current = false;
        let done = 0;
        setBatch({ done, total: plan.total, stopping: false });
        const byId = new Map(itemsRef.current.map((item) => [item.id, item]));
        const settle = () => {
            done += 1;
            setBatch((current) => (current ? { ...current, done } : current));
        };
        // Per machine in order (the Happier CLI last, it restarts the daemon the others travel
        // through); machines side by side; the app only downloads — its restart is the person's.
        await Promise.all([
            ...plan.machines.map(async (machine) => {
                for (const itemId of machine.itemIds) {
                    if (stopRef.current) return;
                    const item = byId.get(itemId);
                    if (item) await executeItem(item);
                    settle();
                }
            }),
            (async () => {
                const appItem = plan.appItemId ? byId.get(plan.appItemId) : undefined;
                if (!appItem || stopRef.current) return;
                if (appItem.action.kind === 'run' && appItem.action.verb === 'update') await app.run();
                settle();
            })(),
        ]);
        setBatch(null);
    }, [app, batch, executeItem]);

    const stopAfterCurrent = React.useCallback(() => {
        stopRef.current = true;
        setBatch((current) => (current ? { ...current, stopping: true } : current));
    }, []);

    const checkNow = React.useCallback(() => {
        void app.checkNow();
        for (const machineId of onlineKey ? onlineKey.split('\u0000') : []) refreshMachineUpdateFacts(serverId, machineId);
    }, [app, onlineKey, serverId]);

    const openWhatsNew = React.useCallback(() => {
        if (releaseNotesLauncher.open()) return;
        router.push('/(app)/changelog');
    }, [releaseNotesLauncher, router]);

    const sessionsRunningKey = storage(selectSessionsRunningKey);
    const sessionsRunningOn = React.useMemo(
        () => new Set(sessionsRunningKey ? sessionsRunningKey.split('\u0000') : []),
        [sessionsRunningKey],
    );
    const checkedAt = app.checkedAt == null && factsCheckedAt == null ? null : Math.max(app.checkedAt ?? 0, factsCheckedAt ?? 0);

    return React.useMemo(() => ({
        summary,
        groups,
        checkedAt,
        uncheckedMachineCount,
        sessionsRunningOn,
        runItem,
        updateAll,
        stopAfterCurrent,
        batch,
        checkNow,
        skipAppVersion: app.skipVersion,
        openWhatsNew,
        whatsNewUnread: releaseNotes.hasUnread,
    }), [app.skipVersion, batch, checkNow, checkedAt, groups, openWhatsNew, releaseNotes.hasUnread, runItem, sessionsRunningOn, stopAfterCurrent, summary, uncheckedMachineCount, updateAll]);
}

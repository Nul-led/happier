import type { LocalDaemonStatusData } from '@/components/settings/machines/localControl/useLocalDaemonControl';
import { isDaemonOnActiveRelay } from '@/sync/domains/server/relayDrift/relayDriftModel';
import type { Session } from '@/sync/domains/state/storageTypes';
import { readDisplayMachineIdForSession } from '@/sync/ops/sessionMachineTarget';
import { isSessionActive } from '@/utils/sessions/sessionUtils';

/**
 * What the app can truthfully say about agent sessions running on this computer — the one owner the
 * quit question (A13-01) and the tray's session counts (A13-07) share.
 *
 * The app sees sessions only for the daemon serving the Home it is on, signed in to its own
 * account, once the session list has loaded. Sessions another Home's service runs are invisible
 * here, so a count is never claimed for them.
 */
export type AppHomeView = Readonly<{
    status: LocalDaemonStatusData | null;
    isDataReady: boolean;
    appAccountId: string | null;
    activeRelayUrl: string | null | undefined;
    activeLocalRelayUrl: string | null | undefined;
    sessions: Readonly<Record<string, Session>> | null;
}>;

let countCache: { sessions: Readonly<Record<string, Session>>; machineId: string; count: number } | null = null;

/** Agent sessions running on the machine with this id, from the canonical liveness and machine owners. */
export function countActiveSessionsOnMachine(sessions: Readonly<Record<string, Session>> | null, machineId: string | null): number {
    if (!sessions || !machineId) return 0;
    // Sessions change far less often than the store notifies; reuse the count until they do.
    if (countCache && countCache.sessions === sessions && countCache.machineId === machineId) return countCache.count;
    let count = 0;
    for (const session of Object.values(sessions)) {
        if (isSessionActive(session)
            && readDisplayMachineIdForSession({ sessionId: session.id, metadata: session.metadata ?? null }) === machineId) {
            count += 1;
        }
    }
    countCache = { sessions, machineId, count };
    return count;
}

function appHomeDaemonIsVisible(view: AppHomeView): view is AppHomeView & { status: LocalDaemonStatusData; appAccountId: string } {
    const status = view.status;
    return view.isDataReady
        && view.appAccountId !== null
        && status !== null
        && status.daemonRunning
        && status.machineId !== null
        && status.daemonAccountId === view.appAccountId
        && isDaemonOnActiveRelay({
            activeRelayUrl: view.activeRelayUrl,
            activeLocalRelayUrl: view.activeLocalRelayUrl ?? null,
            daemonRelayUrl: status.daemonServerUrl ?? null,
        }) === true;
}

/** Agent sessions running here for the app's Home; `null` when the app cannot see them. */
export function readAppHomeSessionCount(view: AppHomeView): number | null {
    return appHomeDaemonIsVisible(view) ? countActiveSessionsOnMachine(view.sessions, view.status.machineId) : null;
}

/**
 * Whether the app's view of sessions covers every running service the app manages (A13-01): the
 * producer's count of running managed services (`runningManagedServiceCount`, from the full
 * inventory) equals the running managed services on the app's own Home, whose sessions the app can
 * see. A default and a pin can share one relay row, and another Home's service is invisible here, so
 * the rows alone never prove it; an unknown count or an incomplete inventory proves nothing.
 */
export function sessionVisibilityCoversManagedServices(view: AppHomeView): boolean {
    const status = view.status;
    const runningManaged = status?.runningManagedServiceCount;
    const rows = status?.serviceRows;
    if (runningManaged == null || !rows || status?.serviceRowsComplete === false) return false;
    const visibleRunningManaged = rows.filter((row) => row.appManaged
        && row.actions.includes('stop')
        && isDaemonOnActiveRelay({
            activeRelayUrl: view.activeRelayUrl,
            activeLocalRelayUrl: view.activeLocalRelayUrl ?? null,
            daemonRelayUrl: row.relayUrl,
        }) === true).length;
    return visibleRunningManaged === runningManaged;
}

/**
 * The agent sessions an aggregate stop of the managed services would end, when the app can know
 * (the quit question): none when the inventory is complete and nothing managed runs (N-15);
 * otherwise the app Home's sessions, but only when they are all the running managed services there
 * are (A13-01). `null` = the app cannot know, so it asks.
 */
export function readSessionsAStopWouldEnd(view: AppHomeView): number | null {
    const status = view.status;
    if (status?.serviceRows && status.serviceRowsComplete !== false && status.runningManagedServiceCount === 0) return 0;
    const count = readAppHomeSessionCount(view);
    return count !== null && sessionVisibilityCoversManagedServices(view) ? count : null;
}

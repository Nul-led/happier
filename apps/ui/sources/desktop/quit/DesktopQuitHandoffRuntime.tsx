import * as React from 'react';

import { readLocalDaemonSharedState, subscribeLocalDaemonSharedState } from '@/components/settings/machines/localControl/localDaemonSharedState';
import { refreshLocalDaemonStatus, type DesktopServiceAutostartMode, type LocalDaemonStatusData } from '@/components/settings/machines/localControl/useLocalDaemonControl';
import { getDefaultSystemTaskRunner, waitForSystemTaskResult } from '@/components/systemTasks';
import { buildLocalDaemonServiceSystemTaskSpec } from '@/components/systemTasks/specs/localControl/buildLocalDaemonServiceSystemTaskSpec';
import type { SystemTaskRunner } from '@/components/systemTasks/types';
import { Modal } from '@/modal';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverProfiles';
import { getStorage } from '@/sync/domains/state/storageStore';
import { t } from '@/text';
import { invokeDesktopHost, isDesktopHost, listenDesktopHostEvent } from '@/utils/platform/desktopHost';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { readSessionsAStopWouldEnd } from '@/desktop/thisComputer/thisComputerSessionVisibility';

import { resolveDesktopQuitDecision, type DesktopQuitIntent } from './resolveDesktopQuitDecision';

/** Emitted by the native shutdown handler once per quit, never per window. */
export const DESKTOP_APP_EXIT_REQUESTED_EVENT = 'desktop_app_exit_requested';

/**
 * The handoff names which Quit was chosen (anything else is the plain "Quit Happier") and, when the
 * native side has one, the login-start mode it last persisted — the only answer before this app
 * open's first status read lands (C8 c).
 */
function readQuitHandoff(payload: unknown): Readonly<{
    intent: DesktopQuitIntent;
    serviceAutostart: DesktopServiceAutostartMode | null;
    menuBarSupported: boolean;
}> {
    const record = payload && typeof payload === 'object'
        ? payload as { stopServices?: unknown; serviceAutostart?: unknown; menuBarSupported?: unknown }
        : {};
    return {
        intent: record.stopServices === true ? 'stopServices' : 'quit',
        // A host without menu-bar mode says so; it then exits where Tauri would stay in the menu bar.
        menuBarSupported: record.menuBarSupported !== false,
        serviceAutostart: record.serviceAutostart === 'at-login' || record.serviceAutostart === 'on-demand' ? record.serviceAutostart : null,
    };
}

/** Cancelling or dismissing keeps the services: only an answer given on purpose ends someone's work. */
async function confirmStopDespiteSessions(sessions: 'running' | 'unknown'): Promise<boolean> {
    let stop = false;
    await Modal.alertAsync(
        sessions === 'running' ? t('settingsDesktop.tray.quitStopTitle') : t('settingsDesktop.tray.quitStopUnknownTitle'),
        sessions === 'running' ? t('settingsDesktop.tray.quitStopBody') : t('settingsDesktop.tray.quitStopUnknownBody'),
        [
            { text: t('settingsDesktop.tray.quitStopKeep'), style: 'cancel', onPress: () => { stop = false; } },
            { text: t('settingsDesktop.tray.quitStopConfirm'), style: 'destructive', onPress: () => { stop = true; } },
        ],
    );
    return stop;
}

/**
 * Stops every background service the app manages through bootstrap's one aggregate stop (each is
 * attempted and every failure named). Resolves the failure to tell the person, or `null`.
 */
async function stopAppManagedServices(runner: SystemTaskRunner): Promise<string | null> {
    try {
        const taskId = await runner.start(buildLocalDaemonServiceSystemTaskSpec('daemon.service.stop.v1', { allManagedServices: true }));
        const result = await waitForSystemTaskResult(runner, taskId);
        if (result.ok) return null;
        console.error('[DesktopQuitHandoff] stopping background services failed', result.error);
        return result.error.message || result.error.code;
    } catch (error) {
        console.error('[DesktopQuitHandoff] stopping background services failed', error);
        return error instanceof Error && error.message ? error.message : String(error);
    }
}

/**
 * A stop that did not go through is never swallowed (C8 b): show what kept running before the
 * handoff retains the app in its window or menu bar.
 */
async function reportServicesStillRunning(detail: string): Promise<void> {
    await invokeDesktopHost('desktop_show_main_window');
    await Modal.alertAsync(
        t('settingsDesktop.tray.quitStopFailedTitle'),
        t('settingsDesktop.tray.quitStopFailedBody', { detail }),
    );
}

/** One app-open start per web UI and runner (a rebuilt window is a new app open for on-demand services). */
const appOpenStartRequested = new WeakSet<SystemTaskRunner>();
/** Runners whose app-open start is waiting for a setup run to end (A14-05). */
const appOpenStartWaitingForSetup = new WeakSet<SystemTaskRunner>();

/**
 * The setup or repair runs of this computer in flight (N-14): the runner that owns every task's
 * lifecycle says so; such a run starts what it set up.
 */
function activeSetupRuns(runner: SystemTaskRunner): readonly string[] {
    return (runner.listActiveTasks?.() ?? []).filter((task) => task.spec.kind.startsWith('setup.')).map((task) => task.taskId);
}

/**
 * A13-03 / R13C-F2 — on-demand services answer while the app is open: once this app open proved
 * that the managed services run on demand, start them through bootstrap's one aggregate start (it
 * skips at-login and running services; none eligible is success). Once per app open. While a setup
 * run is in flight the attempt is not spent (A14-05): it waits on that run's own lifecycle and is
 * made when the run ends, for the services the run did not start. No timer; a failure is logged,
 * every surface still shows the services as offline, and nothing is retried.
 */
async function startOnDemandServicesForAppOpen(runner: SystemTaskRunner): Promise<void> {
    if (appOpenStartRequested.has(runner) || runner.mode === 'unavailable') return;
    if (readLocalDaemonSharedState<LocalDaemonStatusData>(runner).status?.serviceAutostart !== 'on-demand') return;
    const setupRuns = activeSetupRuns(runner);
    if (setupRuns.length > 0) {
        if (appOpenStartWaitingForSetup.has(runner)) return;
        appOpenStartWaitingForSetup.add(runner);
        for (const taskId of setupRuns) {
            const unsubscribe = runner.subscribe(taskId, () => {
                if (!runner.getSnapshot(taskId)?.result) return;
                unsubscribe();
                // Look again: another setup run may still be going (then this waits on it instead).
                appOpenStartWaitingForSetup.delete(runner);
                fireAndForget(startOnDemandServicesForAppOpen(runner), { tag: 'DesktopAppLifecycle.appOpenStart' });
            });
        }
        return;
    }
    appOpenStartRequested.add(runner);
    try {
        const taskId = await runner.start(buildLocalDaemonServiceSystemTaskSpec('daemon.service.start.v1', { allManagedServices: true }, { onDemandOnly: true }));
        const result = await waitForSystemTaskResult(runner, taskId);
        if (!result.ok) console.error('[DesktopAppLifecycle] starting on-demand background services failed', result.error);
        await refreshLocalDaemonStatus(runner);
    } catch (error) {
        console.error('[DesktopAppLifecycle] starting on-demand background services failed', error);
    }
}

/**
 * The desktop app's own lifecycle for this computer's services: as it opens, on-demand services
 * start (A13-03); as it quits, it answers the native Quit handoff (R16 a): keep the tray and the services (menu-bar mode), or stop
 * the services the app manages and exit, or exit touching nothing. It decides from what the app
 * already knows — the last shared status of this computer — and starts no read while the exit is
 * held. The native host applies the final shutdown outcome, retaining the app on a failed stop.
 */
function TauriDesktopQuitHandoffRuntime(): null {
    const runner = React.useMemo(() => getDefaultSystemTaskRunner(), []);
    const subscribe = React.useCallback((listener: () => void) => subscribeLocalDaemonSharedState(runner, listener), [runner]);
    const readManagedMode = React.useCallback(
        () => readLocalDaemonSharedState<LocalDaemonStatusData>(runner).status?.serviceAutostart ?? null,
        [runner],
    );
    const managedMode = React.useSyncExternalStore(subscribe, readManagedMode, readManagedMode);
    React.useEffect(() => {
        if (managedMode !== 'on-demand') return;
        fireAndForget(startOnDemandServicesForAppOpen(runner), { tag: 'DesktopAppLifecycle.appOpenStart' });
    }, [managedMode, runner]);
    React.useEffect(() => {
        let disposed = false;
        let unlisten: (() => void) | null = null;
        void listenDesktopHostEvent<unknown>(DESKTOP_APP_EXIT_REQUESTED_EVENT, (payload) => {
            void (async () => {
                let keepInMenuBar = false;
                try {
                    const status = readLocalDaemonSharedState<LocalDaemonStatusData>(runner).status;
                    const handoff = readQuitHandoff(payload);
                    // The one login-start setting governs the quit (A13-02), never one scoped service's mode.
                    const serviceAutostart = status ? status.serviceAutostart ?? null : handoff.serviceAutostart;
                    const storage = getStorage().getState();
                    const activeServer = getActiveServerSnapshot();
                    const view = {
                        status,
                        isDataReady: storage.isDataReady,
                        appAccountId: storage.profile?.id?.trim() || null,
                        activeRelayUrl: activeServer.serverUrl,
                        activeLocalRelayUrl: activeServer.activeLocalRelayUrl ?? null,
                        sessions: storage.sessions ?? null,
                    };
                    const visibleSessionCount = readSessionsAStopWouldEnd(view);
                    const decision = resolveDesktopQuitDecision({
                        intent: handoff.intent,
                        serviceAutostart,
                        activeLocalSessionCount: visibleSessionCount ?? 0,
                        canSeeDaemonSessions: visibleSessionCount !== null,
                    });
                    // Whenever the services outlive this quit and start at login, the tray does too (C8 a).
                    keepInMenuBar = handoff.menuBarSupported && serviceAutostart === 'at-login';
                    if (decision === 'keepInMenuBar' || decision === 'leaveRunning') return;
                    if (decision === 'ask' || decision === 'askUnknown') {
                        // A tray Quit leaves the window hidden; ask where the person can see it.
                        await invokeDesktopHost('desktop_show_main_window');
                        if (!await confirmStopDespiteSessions(decision === 'ask' ? 'running' : 'unknown')) return;
                    }
                    const failure = await stopAppManagedServices(runner);
                    // A stop that failed keeps the app with the services it could not stop: in the
                    // menu bar, or — on a host without one — in its window (N-9).
                    keepInMenuBar = failure !== null;
                    if (failure !== null) await reportServicesStillRunning(failure);
                } catch (error) {
                    // Keep the established handoff outcome if presenting the question or failure breaks.
                    console.error('[DesktopQuitHandoff] quit handoff failed', error);
                } finally {
                    // The webview is torn down around this handler, so finishing can reject too.
                    void (keepInMenuBar
                        ? invokeDesktopHost('desktop_finish_shutdown', { outcome: 'menuBar' })
                        : invokeDesktopHost('desktop_finish_shutdown')).catch(() => {});
                }
            })();
        }).then((stop) => {
            if (disposed) stop();
            else unlisten = stop;
        }).catch(() => {
            // No handoff reaches this webview: the native side finishes the quit on its own.
        });
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, [runner]);
    return null;
}

export function DesktopQuitHandoffRuntime(): React.ReactElement | null {
    if (!isDesktopHost()) return null;
    return <TauriDesktopQuitHandoffRuntime />;
}

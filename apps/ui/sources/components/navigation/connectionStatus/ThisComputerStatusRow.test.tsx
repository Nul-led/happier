import * as React from 'react';
import renderer from 'react-test-renderer';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SystemTaskRunner, SystemTaskBridge } from '@/components/systemTasks/types';
import { renderScreen } from '@/dev/testkit';
import { installServerSettingsHooksCommonModuleMocks } from '@/components/settings/server/hooks/serverSettingsHooksTestHelpers';

const state = vi.hoisted(() => ({
    activeServerSnapshot: { serverId: 'relay-b', serverUrl: 'https://relay-b.example.test', generation: 1 },
    runner: null as SystemTaskRunner | null,
    setupSpecs: [] as unknown[],
}));

installServerSettingsHooksCommonModuleMocks({
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
        });
    },
});

vi.mock('@/utils/platform/tauri', () => ({
    isTauriDesktop: () => true,
}));

vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    getActiveServerAccountScope: () => ({ serverId: state.activeServerSnapshot.serverId, accountId: 'acct_app' }),
}));

vi.mock('@/components/systemTasks/systemTasksRuntime', () => ({
    getSystemTasksRunner: () => state.runner,
}));

vi.mock('@/components/systemTasks', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/systemTasks')>();
    return { ...actual, getDefaultSystemTaskRunner: () => state.runner };
});

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerSnapshot: () => state.activeServerSnapshot,
    getWebSameOriginServerUrl: () => null,
    listServerProfiles: () => [],
}));

vi.mock('@/sync/domains/server/serverRuntime', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverRuntime')>();
    return { ...actual, getActiveServerSnapshot: () => state.activeServerSnapshot };
});

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ refreshFromActiveServer: async () => {} }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function daemonOn(serverUrl: string, targetMode: 'default-following' | 'pinned', overrides: Readonly<{ running?: boolean; accountId?: string; accountLabel?: string }> = {}) {
    const running = overrides.running ?? true;
    const accountId = overrides.accountId ?? 'acct_app';
    return {
        // A JSON-only payload (the bridge validates it): the key is absent, never `undefined`.
        ...(targetMode === 'pinned' ? { managedBy: 'desktop' } : {}),
        serviceInstalled: true,
        daemonRunning: true,
        needsAuth: false,
        machineId: `machine-${targetMode}`,
        acquisition: { command: '/home/user/.happier/cli/current/happier', provenance: 'managed' },
        server: { activeServerId: targetMode, serverUrl, publicServerUrl: serverUrl, localServerUrl: null, comparableKey: serverUrl },
        auth: {
            authenticated: true,
            machineRegistered: true,
            machineId: `machine-${targetMode}`,
            needsAuth: false,
            accountId,
            credentialState: 'valid',
            validatedAccountId: accountId,
            ...(overrides.accountLabel ? { accountLabel: overrides.accountLabel } : {}),
        },
        service: { installed: true, running, targetMode },
        daemon: { running, startedWithCliVersion: '0.2.13', serviceManaged: true, serviceLabel: 'label' },
        runtimeConvergence: { controlReachable: running, serviceOwnsRunningDaemon: running, machineIdMatches: running, cliVersionMatches: running },
    };
}

type DaemonPayload = ReturnType<typeof daemonOn>;

/**
 * The executor's status result as bootstrap sends it (R16): the facts, and the one list of this
 * computer's services (`serviceRows`), each judged against its own relay's account.
 */
function statusResult(defaultDaemon: DaemonPayload, pinned: readonly DaemonPayload[]) {
    const row = (daemon: DaemonPayload, serving: 'default-following' | 'pinned') => ({
        relayUrl: daemon.server.serverUrl,
        state: daemon.runtimeConvergence.controlReachable ? 'connected' : 'offline',
        appManaged: true,
        serving,
        actions: daemon.runtimeConvergence.controlReachable ? ['restart', 'stop'] : ['start'],
    });
    return {
        ...defaultDaemon,
        pinnedServices: { complete: true, coexistence: true, services: pinned, unreadable: [] },
        serviceRows: [row(defaultDaemon, 'default-following'), ...pinned.map((daemon) => row(daemon, 'pinned'))],
    };
}

/** The desktop bridge boundary: the one ambient status read, and any setup run the action starts. */
async function installBridge(statusData: unknown): Promise<void> {
    const { createSystemTaskRunner } = await import('@/components/systemTasks/createSystemTaskRunner');
    const bridge: SystemTaskBridge = {
        start: async (spec) => {
            if (spec.kind === 'daemon.service.status.v1') return 'task_status';
            state.setupSpecs.push(spec);
            return 'task_setup';
        },
        async subscribe(taskId, listenerSet) {
            if (taskId === 'task_status') {
                queueMicrotask(() => listenerSet.onResult({ protocolVersion: 1, taskId, ok: true, data: statusData as never }));
            }
            return () => {};
        },
        async cancel() {},
        async respond() {},
    };
    state.runner = createSystemTaskRunner({ mode: 'dev', bridge });
}

/** Each relay row as `host|state`, the way it reads. */
function relayStates(screen: Awaited<ReturnType<typeof renderScreen>>): string[] {
    const rows = screen.findAll((node) => node.props?.testID === 'connection-popover-this-computer-relay').map((node) => {
        const texts = node.findAll((child) => typeof child.props.children === 'string').map((child) => child.props.children as string);
        return [...new Set(texts)].join('|');
    });
    // A row may appear as both its component and its host element; each row reads once.
    return rows.filter((row, index) => rows.indexOf(row) === index);
}

async function renderRow() {
    const { ThisComputerStatusRow } = await import('./ThisComputerStatusRow');
    const screen = await renderScreen(<ThisComputerStatusRow rowStyle={null} labelStyle={null} valueStyle={null} />);
    await renderer.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return screen;
}

describe('ThisComputerStatusRow', () => {
    beforeEach(() => {
        vi.resetModules();
        state.activeServerSnapshot = { serverId: 'relay-b', serverUrl: 'https://relay-b.example.test', generation: 1 };
        state.setupSpecs = [];
    });

    it('lists every relay this computer serves and offers nothing when it serves the app relay', async () => {
        await installBridge(statusResult(daemonOn('https://relay-a.example.test', 'default-following'), [daemonOn('https://relay-b.example.test', 'pinned')]));
        const screen = await renderRow();

        expect(relayStates(screen)).toEqual([
            'relay-a.example.test|connectionStatus.thisComputerRelayConnected',
            'relay-b.example.test|connectionStatus.thisComputerRelayConnected',
        ]);
        expect(screen.findAllHostsByTestId('connection-popover-connect-this-computer')).toHaveLength(0);
    });

    it('offers one "Connect this computer" action when no daemon here serves the app relay', async () => {
        await installBridge(statusResult(daemonOn('https://relay-a.example.test', 'default-following'), []));
        const screen = await renderRow();

        expect(relayStates(screen)).toEqual(['relay-a.example.test|connectionStatus.thisComputerRelayConnected']);
        expect(screen.getTextContent()).toContain('server.relayDrift.connectHereAction');
        expect(screen.findAllHostsByTestId('connection-popover-connect-this-computer').length).toBeGreaterThan(0);
    });
    it('never calls a stopped daemon connected: it is set up for its relay and offline (M4)', async () => {
        await installBridge(statusResult(daemonOn('https://relay-a.example.test', 'default-following'), [daemonOn('https://relay-b.example.test', 'pinned', { running: false })]));
        const screen = await renderRow();

        expect(relayStates(screen)).toContain('connectionStatus.thisComputerSetUpFor:{"relay":"relay-b.example.test"}|connectionStatus.thisComputerRelayOffline');
    });

    it('keeps the sentence naming both accounts, and says the app relay needs attention, when this computer answers there as someone else (U7/R17)', async () => {
        // The executor sees relay-b's daemon converged for its own account; the app is on relay-b as
        // another account, so the app re-judges that one row.
        await installBridge(statusResult(daemonOn('https://relay-a.example.test', 'default-following'), [daemonOn('https://relay-b.example.test', 'pinned', { accountId: 'acct_other', accountLabel: 'bob' })]));
        const screen = await renderRow();

        expect(relayStates(screen)).toContain('relay-b.example.test|connectionStatus.thisComputerRelayNeedsAttention');
        expect(screen.getTextContent()).toContain('server.relayDrift.bannerAccountMismatchDescription');
        expect(screen.getTextContent()).toContain('bob');
    });
});

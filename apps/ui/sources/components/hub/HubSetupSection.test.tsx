import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { HubSetupSection } from './HubSetupSection';
import { ListPresentationProvider } from '@/components/ui/lists/listPresentation';
import { discardMachineAddFlowDraft } from '@/components/machines/add/machineAddFlowStore';
import { getActiveServerId, removeServerProfile, setActiveServerId, upsertServerProfile } from '@/sync/domains/server/serverProfiles';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    machines: [] as unknown[],
    machineListSettled: true,
    dismissed: false,
    show: null as null | ((options: unknown) => void),
    window: { width: 1600, height: 900 },
    push: null as null | ((href: unknown) => void),
    layout: { order: [] as string[], hidden: [] as string[] },
    authenticated: true,
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    // The window size decides computer vs phone-sized web.
    return createReactNativeWebMock({
        useWindowDimensions: () => ({ ...state.window, scale: 2, fontScale: 1 }),
    });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    const router = createExpoRouterMock();
    router.spies.push.mockImplementation((href: unknown) => { state.push?.(href); });
    return router.module;
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    // The modal boundary: the test captures what the step asked it to show.
    const show = ((options: unknown) => {
        state.show?.(options);
        return 'modal-id';
    }) as never;
    return createModalModuleMock({ spies: { show } }).module;
});
vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const React = await import('react');
    const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleMock({ importOriginal, overrides: {
        // Preserve the real store and its live getters, including through import cycles.
        // Only the inherited section fixtures below replace hooks.
        useAllMachines: () => state.machines,
        useIsActiveMachineListSettled: () => state.machineListSettled,
        // The machine and pool lists the add-machine options read (empty: this Home has no pools).
        useMachineListByServerId: () => ({}),
        useMachineListStatusByServerId: () => ({}),
        useMachinePoolListByServerId: () => ({}),
        useMachinePoolListStatusByServerId: () => ({}),
        useMachinePoolAccountIdByServerId: () => ({}),
        // The Account's synced settings (the Home layout holds dismissed setup steps).
        useSettingMutable: (key: string) => {
            if (key !== 'homeHubLayoutV1') throw new Error(`unexpected setting ${key}`);
            const [value, setValue] = React.useState(state.layout);
            return [value, (next: typeof state.layout) => { state.layout = next; setValue(next); }] as const;
        },
    } });
});
// The Home's feature probe (HTTP): no Home answers here, so a pairing code cannot be made.
vi.mock('@/sync/api/capabilities/serverFeaturesClient', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/api/capabilities/serverFeaturesClient')>(),
    getServerFeaturesSnapshot: async () => ({ status: 'error', reason: 'network' }),
}));
vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: state.authenticated, credentials: state.authenticated ? { token: 't', secret: 's' } : null }),
}));
// Device storage for the recovery-key flag, and the server's feature answer (HTTP).
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
    return {
        ...actual,
        TokenStorage: {
            ...actual.TokenStorage,
            getRecoveryKeyReminderDismissed: async () => state.dismissed,
            setRecoveryKeyReminderDismissed: async (value: boolean) => { state.dismissed = value; return true; },
            getCachedRecoveryKeyReminderDismissed: () => null,
        },
        isLegacyAuthCredentials: (credentials: unknown) => Boolean(credentials),
    };
});
vi.mock('@/sync/api/capabilities/getReadyServerFeatures', () => ({
    getReadyServerFeatures: async () => ({ features: { auth: { ui: { recoveryKeyReminder: { enabled: true } } } } }),
    getCachedReadyServerFeatures: () => null,
}));
// The plugins machine's cached answer (none in this launch).
vi.mock('@/components/settings/plugins/model/pluginAdministrationSummary', () => ({
    usePluginAdministrationSummary: () => ({ known: false, awaitingDecision: 0, userInstalled: 0 }),
}));
// The Homes journeys' steps (their own owner and suite, `components/homes/journeys/**`) lead this row
// through the same morph; their account-service discovery is network-backed, so this suite leaves them
// out and covers Get set up's own items.
vi.mock('@/components/homes/journeys/useHomesJourneySetupItems', () => ({
    useHomesJourneySetupItems: () => [],
}));
// Connected services own their block (its suite is theirs); this suite covers Get set up's own items.
vi.mock('@/components/settings/connectedServices/home/useConnectServicesSetupItem', () => ({
    useConnectServicesSetupItem: () => null,
}));
vi.mock('@/hooks/session/useConnectTerminal', () => ({
    useConnectTerminal: () => ({ connectTerminal: vi.fn(), isLoading: false }),
}));
vi.mock('@/hooks/auth/useScannedAuthUrlProcessor', () => ({
    useScannedAuthUrlProcessor: () => ({ processAuthUrl: vi.fn() }),
}));

afterEach(() => {
    standardCleanup();
    discardMachineAddFlowDraft();
    state.authenticated = true;
    state.machines = [];
    state.machineListSettled = true;
    state.dismissed = false;
    state.window = { width: 1600, height: 900 };
    state.push = null;
    state.layout = { order: [], hidden: [] };
    vi.unstubAllGlobals();
    // No `vi.resetModules()`: re-importing the section's module graph for every case kept each
    // previous graph alive and ran the worker out of memory (about 1 GB per case). The device facts
    // it depended on are read at call time (window size, `navigator`), and the recovery-key reminder's
    // one shared state is driven through its storage boundary (`state.dismissed`) in case order.
});

async function renderSection(presentation?: 'tiles' | 'checklist') {
    // Both hubs are pages: the checklist's progress lives in the page section header.
    const screen = await renderScreen(
        <ListPresentationProvider value="page"><HubSetupSection presentation={presentation} /></ListPresentationProvider>,
    );
    await flushHookEffects({ cycles: 3 });
    return screen;
}

const phoneWindow = () => {
    state.window = { width: 360, height: 800 };
    vi.stubGlobal('navigator', { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' });
};

describe('HubSetupSection on Home (tiles)', () => {
    it('offers saving the recovery key until it is saved or dismissed', async () => {
        let onSaved: (() => Promise<void>) | null = null;
        state.show = (options) => { onSaved = (options as { props: { onSaved: () => Promise<void> } }).props.onSaved; };
        const screen = await renderSection();

        await act(async () => { screen.pressByTestId('hub-setup.recoveryKey.action'); });
        expect(onSaved).not.toBeNull();
        await act(async () => { await onSaved!(); });
        await flushHookEffects({ cycles: 2 });
        expect(screen.findByTestId('hub-setup.recoveryKey')).toBeNull();
    });

    it('removes the first-machine step once the Home has a machine, keeping phone setup available', async () => {
        state.dismissed = true;
        state.machines = [{ id: 'm1', metadata: null }];
        const screen = await renderSection();

        expect(screen.findByTestId('settings-add-your-phone-shortcut')).toBeTruthy();
        expect(Boolean(screen.findByTestId('hub-setup.installComputer'))).toBe(false);
        expect(screen.findByTestId('hub-setup.addMachine')).toBeNull();
        state.machineListSettled = false;
        const unknown = await renderSection();
        expect(unknown.findByTestId('hub-setup.addMachine')).toBeTruthy();
    });

    it('"Show QR code" grows the pairing panel in place instead of leaving Home', async () => {
        state.dismissed = true;
        const pushed: unknown[] = [];
        state.push = (href) => { pushed.push(href); };
        const screen = await renderSection();
        expect(screen.findByTestId('hub-setup.pairing-panel')).toBeNull();

        await act(async () => { screen.pressByTestId('settings-add-your-phone-shortcut.action'); });
        await flushHookEffects({ cycles: 3 });

        expect(pushed).toEqual([]);
        expect(screen.findByTestId('hub-setup.pairing-panel')).toBeTruthy();
    });

    it('Another computer offers a Home pairing link first and keeps the terminal as an alternative', async () => {
        state.dismissed = true;
        const screen = await renderSection();
        await act(async () => { screen.pressByTestId('hub-setup.addMachine.action'); });
        await act(async () => { screen.pressByTestId('hub-setup.add-machine-panel.path.anotherComputer'); });
        await flushHookEffects({ cycles: 2 });
        expect(screen.findByTestId('hub-setup.add-machine-panel.pane.pairing-panel')).toBeTruthy();
        expect(screen.findByTestId('hub-setup.add-machine-panel.pane.command')).toBeNull();
        await act(async () => { screen.pressByTestId('hub-setup.add-machine-panel.pane.terminal'); });
        expect(screen.findByTestId('hub-setup.add-machine-panel.pane.command')).toBeTruthy();
    });

    it('keeps pairing admission scoped to the draft Home after focus moves to a signed-out Home', async () => {
        const previousServerId = getActiveServerId();
        const home = await upsertServerProfile({ serverUrl: 'https://machine-draft.test', name: 'Draft Home' });
        const other = await upsertServerProfile({ serverUrl: 'https://machine-other.test', name: 'Other Home' });
        state.dismissed = true;
        try {
            await setActiveServerId(home.id);
            const screen = await renderSection();
            await act(async () => { screen.pressByTestId('hub-setup.addMachine.action'); });
            await act(async () => { await setActiveServerId(other.id); });
            state.authenticated = false;
            await act(async () => { screen.pressByTestId('hub-setup.add-machine-panel.path.anotherComputer'); });
            await flushHookEffects({ cycles: 3 });
            // The real pairing owner reports this retained Home's failed HTTP probe, rather than
            // spinning forever because the different, focused Home is signed out.
            expect(screen.findByTestId('hub-setup.add-machine-panel.pane.pairing-invalid-request')).toBeTruthy();
        } finally {
            await setActiveServerId(previousServerId);
            await removeServerProfile(home.id);
            await removeServerProfile(other.id);
        }
    });

    it('a dismissed step leaves Home and is kept on the Account layout', async () => {
        state.dismissed = true;
        const screen = await renderSection();

        await act(async () => { screen.pressByTestId('hub-setup.addMachine.dismiss'); });
        await flushHookEffects({ cycles: 2 });

        expect(screen.findByTestId('hub-setup.addMachine')).toBeNull();
        expect(state.layout.hidden).toEqual(['setup:addMachine']);
        expect(screen.findByTestId('settings-add-your-phone-shortcut')).toBeTruthy();
    });

    it('leaves Home once every step is done or dismissed', async () => {
        state.dismissed = true;
        state.layout = { order: [], hidden: ['setup:addPhone', 'setup:addMachine', 'setup:installComputer'] };
        const screen = await renderSection();

        expect(screen.findByTestId('hub-setup.grid')).toBeNull();
        expect(screen.findByTestId('settings-add-your-phone-shortcut')).toBeNull();
    });

    it('on a phone offers connecting a computer (opening in place) and adding a machine, not the phone QR', async () => {
        state.dismissed = true;
        phoneWindow();
        const screen = await renderSection();

        expect(screen.findByTestId('settings-add-your-phone-shortcut')).toBeNull();
        expect(screen.findByTestId('hub-setup.addMachine')).toBeTruthy();
        expect(screen.findByTestId('hub-setup.connect-computer-panel')).toBeNull();

        await act(async () => { screen.pressByTestId('hub-setup.connectComputer.action'); });
        await flushHookEffects({ cycles: 2 });
        expect(screen.findByTestId('hub-setup.connect-computer-panel')).toBeTruthy();
    });
});

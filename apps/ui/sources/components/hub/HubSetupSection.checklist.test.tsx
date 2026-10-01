import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    machines: [] as unknown[],
    machineListSettled: true,
    dismissed: false,
    show: null as null | ((options: unknown) => void),
    window: { width: 1600, height: 900 },
    push: null as null | ((href: unknown) => void),
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
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useAllMachines: () => state.machines,
        useIsActiveMachineListSettled: () => state.machineListSettled,
    });
});
vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true, credentials: { token: 't', secret: 's' } }),
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
vi.mock('@/hooks/session/useConnectTerminal', () => ({
    useConnectTerminal: () => ({ connectTerminal: vi.fn(), isLoading: false }),
}));
vi.mock('@/hooks/auth/useScannedAuthUrlProcessor', () => ({
    useScannedAuthUrlProcessor: () => ({ processAuthUrl: vi.fn() }),
}));

afterEach(() => {
    standardCleanup();
    state.machines = [];
    state.machineListSettled = true;
    state.dismissed = false;
    state.window = { width: 1600, height: 900 };
    state.push = null;
    vi.unstubAllGlobals();
    // No `vi.resetModules()` per case: re-importing this section's module graph for every case kept
    // each previous graph alive and ran the worker out of memory (see HubSetupSection.test.tsx).
});

async function renderSection(presentation?: 'tiles' | 'checklist') {
    const [{ HubSetupSection }, { ListPresentationProvider }] = await Promise.all([
        import('./HubSetupSection'),
        import('@/components/ui/lists/listPresentation'),
    ]);
    // Both hubs are pages: the checklist's progress lives in the page section header.
    const screen = await renderScreen(
        <ListPresentationProvider value="page"><HubSetupSection presentation={presentation} /></ListPresentationProvider>,
    );
    await flushHookEffects({ cycles: 3 });
    return screen;
}

/** The progress label as the mock text owner renders it. */
const progress = (done: number, total: number) => `settingsOverview.setupProgress(done=${done},total=${total})`;

describe('HubSetupSection as a checklist (Settings Overview)', () => {
    it('counts every row it shows on this computer, plus the steps already done', async () => {
        state.machines = [{ id: 'm1', metadata: null }];
        const screen = await renderSection('checklist');

        // Done: a machine exists (its row has left). Shown: the recovery key and "Add your phone".
        expect(screen.findByTestId('hub-setup.addMachine')).toBeNull();
        expect(screen.findByTestId('hub-setup.recoveryKey')).toBeTruthy();
        expect(screen.findByTestId('settings-add-your-phone-shortcut')).toBeTruthy();
        expect(screen.getTextContent()).toContain(progress(1, 3));
    });

    it('on a phone, connecting a computer is one step: Scan, with "Paste link" beside it', async () => {
        state.machines = [{ id: 'm1', metadata: null }];
        state.window = { width: 360, height: 800 };
        vi.stubGlobal('navigator', { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' });
        const screen = await renderSection('checklist');

        expect(screen.findByTestId('settings-add-your-phone-shortcut')).toBeNull();
        // One row, two ways to complete it.
        expect(screen.findByTestId('hub-setup.connectComputer')).toBeTruthy();
        expect(screen.findByTestId('settings-connect-terminal-scan')).toBeTruthy();
        expect(screen.findByTestId('settings-connect-terminal-enter-url')).toBeTruthy();
        // Done: a machine. Shown: the recovery key and connecting a computer.
        expect(screen.getTextContent()).toContain(progress(1, 3));
    });

    it('does not count "Add a machine" while the machine list is not known yet', async () => {
        state.machineListSettled = false;
        const screen = await renderSection('checklist');

        expect(screen.findByTestId('hub-setup.addMachine')).toBeNull();
        expect(screen.getTextContent()).toContain(progress(0, 2));
    });

    it('a step that is done leaves the list and counts as done', async () => {
        state.dismissed = true;
        // The reminder reads the stored answer once per launch: this case is a new launch.
        vi.resetModules();
        state.machines = [{ id: 'm1', metadata: null }];
        const screen = await renderSection('checklist');

        expect(screen.findByTestId('hub-setup.recoveryKey')).toBeNull();
        expect(screen.findByTestId('settings-add-your-phone-shortcut')).toBeTruthy();
        expect(screen.getTextContent()).toContain(progress(2, 3));
    });
});

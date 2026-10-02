import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { createMachineFixture, flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { HubSetupSection } from './HubSetupSection';
import { AddPhoneSettingsView } from '@/components/settings/account/AddPhoneSettingsView';
import { ListPresentationProvider } from '@/components/ui/lists/listPresentation';
import { discardMachineAddFlowDraft } from '@/components/machines/add/machineAddFlowStore';
import { getActiveServerId, removeServerProfile, setActiveServerId, upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import type { HomeHubLayoutValue } from './layout/homeHubLayout';
import type { getServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import type { Machine } from '@/sync/domains/state/storageTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    machines: [] as Machine[],
    machineListSettled: true,
    dismissed: false,
    show: null as null | ((options: unknown) => void),
    window: { width: 1600, height: 900 },
    push: null as null | ((href: unknown) => void),
    params: {} as { setupStep?: string },
    layout: { order: [], hidden: [] } as HomeHubLayoutValue,
    layoutListeners: new Set<() => void>(),
    writeLayout: null as null | ((next: HomeHubLayoutValue) => void),
    authenticated: true,
    featureSnapshot: vi.fn<typeof getServerFeaturesSnapshot>(async () => ({ status: 'error', reason: 'network' })),
    pairingCredentials: null as null | { token: string },
    request: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(),
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
    const router = createExpoRouterMock({ params: () => state.params });
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
    const { createStorageModuleMock, createUseSettingMutableMockFromReader } = await import('@/dev/testkit/mocks/storage');
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
        useSettingMutable: createUseSettingMutableMockFromReader((key) => {
            if (key !== 'homeHubLayoutV1') throw new Error(`unexpected setting ${key}`);
            // The Account boundary has one shared snapshot; per-reader useState falsely made
            // setup and its panel frame observe different layout writes.
            const value = React.useSyncExternalStore((listener) => {
                state.layoutListeners.add(listener);
                return () => { state.layoutListeners.delete(listener); };
            }, () => state.layout);
            const write = React.useCallback((next: typeof state.layout) => {
                state.layout = next;
                for (const listener of state.layoutListeners) listener();
            }, []);
            state.writeLayout = write;
            return [value, write] as const;
        }),
    } });
});
// The Home's feature probe (HTTP): no Home answers here, so a pairing code cannot be made.
vi.mock('@/sync/api/capabilities/serverFeaturesClient', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/api/capabilities/serverFeaturesClient')>(),
    getServerFeaturesSnapshot: (...args: Parameters<typeof getServerFeaturesSnapshot>) => state.featureSnapshot(...args),
    observeAuthenticatedServerFeaturesFresh: () => state.featureSnapshot({}),
}));
// Pairing HTTP and persisted credentials are system boundaries; the real QR lifecycle runs below them.
vi.mock('@/sync/http/client', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/http/client')>(),
    createServerFetchAtEndpoint: () => state.request,
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
            getCredentialsForServerUrl: async () => state.pairingCredentials,
        },
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
    state.params = {};
    state.layout = { order: [], hidden: [] };
    state.writeLayout = null;
    state.layoutListeners.clear();
    state.featureSnapshot.mockReset();
    state.featureSnapshot.mockResolvedValue({ status: 'error', reason: 'network' });
    state.pairingCredentials = null;
    state.request.mockReset();
    vi.useRealTimers();
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
    // Recovery is a launch-lifetime singleton; exercise its pending → saved transition before
    // later cases mount a runtime whose recovery flag is already handled.
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
    it.each(['tiles', 'checklist'] as const)('completes phone setup only after successful pairing from %s and keeps completion in the existing synced layout', async (presentation) => {
        vi.useFakeTimers();
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { computeHomeQrBindingProofV2, FeaturesResponseSchema } = await import('@happier-dev/protocol');
        const { parseHomeQrInviteDeepLink } = await import('@/auth/pairing/pairingUrl');
        const { decodeBase64, encodeBase64 } = await import('@/encryption/base64');
        const previousServerId = getActiveServerId();
        const descriptor = {
            v: 1 as const, homeServerIdentityId: 'srv_phone_setup', canonicalServerUrl: 'https://phone-setup.test',
            revision: 1, endpoints: [{ kind: 'https' as const, url: 'https://phone-setup.test' }],
        };
        const home = await profiles.adoptHomeProfile({ descriptor, source: 'qr', descriptorAuthority: 'current_connection_observation' });
        state.featureSnapshot.mockResolvedValue({
            status: 'ready', serverIdentityId: descriptor.homeServerIdentityId,
            features: FeaturesResponseSchema.parse({ features: { auth: { pairing: { boundQrV2: { enabled: true } } } }, capabilities: {}, homeConnectionDescriptor: descriptor }),
        });
        state.pairingCredentials = { token: 'trusted-home-token' };
        state.dismissed = true;
        state.layout = { order: ['setup', 'future-section'], hidden: ['usage'], sections: { setup: { frameStyle: 'plain' } } };
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        let requested: Record<string, unknown> | null = null;
        state.request.mockImplementation(async (path) => {
            const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
            if (path === '/v1/auth/pairing/start') return json({ pairId: 'setup-pair', expiresAt });
            if (path.startsWith('/v1/auth/pairing/status?')) return json(requested ?? { state: 'pending', pairId: 'setup-pair', expiresAt });
            if (path === '/v1/auth/account/response' || path === '/v1/auth/pairing/consume') return json({ success: true });
            throw new Error(`Unexpected pairing request: ${path}`);
        });
        try {
            await setActiveServerId(home.id);
            let screen = await renderSection(presentation);
            state.push = (href) => {
                state.params = { setupStep: new URL(String(href), 'https://app.test').searchParams.get('setupStep') ?? undefined };
            };
            await act(async () => { screen.pressByTestId('settings-add-your-phone-shortcut.action'); });
            if (presentation === 'checklist') {
                await screen.unmount();
                screen = await renderScreen(<ListPresentationProvider value="page"><AddPhoneSettingsView /></ListPresentationProvider>);
            }
            await flushHookEffects({ cycles: 3 });
            const code = screen.tree.root.find((node) => typeof node.props.data === 'string' && parseHomeQrInviteDeepLink(node.props.data) !== null);
            const parsed = parseHomeQrInviteDeepLink(code.props.data);
            if (!parsed) throw new Error('Expected the real pairing invite');
            expect(state.layout.hidden).toEqual(['usage']);
            // An Account layout update while pairing is pending must not be overwritten by success.
            await act(async () => {
                state.writeLayout?.({ ...state.layout, hidden: ['usage', 'machines'] });
            });
            const publicKey = new Uint8Array(32).fill(9);
            requested = {
                state: 'requested', pairId: parsed.invite.pairId, expiresAt, requestedPublicKey: encodeBase64(publicKey),
                // Completion does not infer a device type from the label.
                requestedDeviceLabel: 'Another device', homeServerIdentityId: descriptor.homeServerIdentityId,
                bindingProof: computeHomeQrBindingProofV2({
                    direction: parsed.invite.direction, qrSecret: decodeBase64(parsed.invite.qrSecretBase64Url, 'base64url'),
                    pairId: parsed.invite.pairId, homeServerIdentityId: descriptor.homeServerIdentityId,
                    requesterPublicKey: publicKey, expiresAtMs: parsed.invite.expiresAtMs,
                }),
            };
            await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
            await flushHookEffects({ cycles: 3 });
            expect(state.request.mock.calls.some(([path]) => path === '/v1/auth/account/response')).toBe(true);
            expect(state.layout.hidden).toEqual(['usage', 'machines', 'setup:addPhone']);
            expect(state.layout.order).toEqual(['setup', 'future-section']);
            expect(state.layout.sections).toEqual({ setup: { frameStyle: 'plain' } });
            expect(screen.findByTestId('settings-add-your-phone-shortcut')).toBeNull();
            await act(async () => { screen.tree.unmount(); });
            const reopened = await renderSection();
            expect(reopened.findByTestId('settings-add-your-phone-shortcut')).toBeNull();
            const checklist = await renderSection('checklist');
            expect(checklist.findByTestId('settings-add-your-phone-shortcut')).toBeNull();
        } finally {
            await act(async () => {
                await setActiveServerId(previousServerId);
                await removeServerProfile(home.id);
            });
        }
    });
    it('removes the first-machine step once the Home has a machine, keeping phone setup available', async () => {
        state.dismissed = true;
        state.machines = [createMachineFixture({ id: 'm1', metadata: null })];
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
        // This fixture's Home probe fails; opening or closing an unsuccessful flow is not completion.
        expect(state.layout.hidden).toEqual([]);
        await screen.unmount();
        expect(state.layout.hidden).toEqual([]);
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
        await act(async () => { screen.pressByTestId('settings-add-your-phone-shortcut.dismiss'); });
        expect(state.layout.hidden).toEqual(['setup:addMachine', 'setup:addPhone']);
        expect(screen.findByTestId('settings-add-your-phone-shortcut')).toBeNull();
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

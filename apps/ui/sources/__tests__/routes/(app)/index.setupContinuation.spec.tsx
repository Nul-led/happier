import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import type { PendingSetupIntent } from '@/sync/domains/pending/pendingSetupIntent.shared';
import type { PersonalHomeFacts } from '@/components/personalHome/bootstrap/personalHomeBootstrapTypes';

vi.mock('@/assets/images/logotype-light.png', () => ({ default: 'logotype-light' }));
vi.mock('@/assets/images/logotype-dark.png', () => ({ default: 'logotype-dark' }));
vi.mock('@/components/onboarding', () => ({
    OnboardingWizardSurface: () => null,
    PreAuthOnboardingWizardEntry: () => null,
}));
vi.mock('@/components/onboarding/preAuth/PreAuthOnboardingWizardEntry', () => ({
    PreAuthOnboardingWizardEntry: (props: Record<string, unknown>) => React.createElement('PreAuthOnboardingWizardEntry', props),
}));

const applyLocalSettingsSpy = vi.hoisted(() => vi.fn());
vi.mock('@/sync/store/settingsWriters', () => ({
    useApplyLocalSettings: () => applyLocalSettingsSpy,
}));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'web' } });
});

const expoRouterMock = createExpoRouterMock({
    router: { push: vi.fn(), replace: vi.fn() },
});
const routeParamsState = vi.hoisted(() => ({
    value: {} as Record<string, string>,
}));
vi.mock('expo-router', () => ({
    ...expoRouterMock.module,
    useGlobalSearchParams: () => routeParamsState.value,
}));

const activeServerState = vi.hoisted(() => ({
    value: {
        serverId: 'server-a',
        serverUrl: 'http://server-a.local',
        generation: 1,
    },
}));
vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => activeServerState.value,
}));

const tauriDesktopState = vi.hoisted(() => ({ value: true }));
vi.mock('@/utils/platform/desktopHost', () => ({
    desktopHostKind: () => tauriDesktopState.value ? 'tauri' : null,
    isDesktopHost: () => tauriDesktopState.value,
}));

let isAuthenticated = true;
vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated,
    }),
}));

vi.mock('@/components/navigation/shell/MainView', () => ({
    MainView: (props: Record<string, unknown>) => React.createElement('MainView', props),
}));

vi.mock('@/components/navigation/shell/HomeHeader', () => ({
    HomeHeaderNotAuth: () => null,
}));

const pendingTerminalConnectState = vi.hoisted(() => ({
    value: null as null | { publicKeyB64Url: string; serverUrl: string },
}));
vi.mock('@/sync/domains/pending/pendingTerminalConnect', () => ({
    getPendingTerminalConnect: () => pendingTerminalConnectState.value,
}));

const connectionHealthState = vi.hoisted(() => ({ value: 0 as number }));
vi.mock('@/components/navigation/connectionStatus/useConnectionHealth', () => ({
    useConnectionHealth: () => ({ onlineCount: connectionHealthState.value }),
}));

const localDaemonStatus = vi.hoisted(() => ({
    value: {
        serviceInstalled: false,
        daemonRunning: false,
        needsAuth: true,
        machineId: null as string | null,
    },
}));
vi.mock('@/components/settings/machines/localControl/useLocalDaemonControl', () => ({
    useLocalDaemonControl: () => ({
        status: localDaemonStatus.value,
    }),
}));

const relayDriftBannerState = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
vi.mock('@/components/settings/server/useRelayDriftBanner', () => ({
    useRelayDriftBanner: () => relayDriftBannerState.value,
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getServerFeaturesSnapshot: vi.fn(async () => ({ status: 'ready', features: { capabilities: { auth: { methods: [] } } } })),
}));

const getPendingSetupIntentMock = vi.hoisted(() => vi.fn<() => PendingSetupIntent | null>(() => ({
    branch: 'thisComputer',
    phase: 'awaiting_auth',
    relayUrl: 'https://relay.example.test',
})));
const clearPendingSetupIntentMock = vi.hoisted(() => vi.fn());
const setPendingSetupIntentMock = vi.hoisted(() => vi.fn<(value: PendingSetupIntent) => void>());
vi.mock('@/sync/domains/pending/pendingSetupIntent', () => ({
    getPendingSetupIntent: () => getPendingSetupIntentMock(),
    clearPendingSetupIntent: clearPendingSetupIntentMock,
    setPendingSetupIntent: setPendingSetupIntentMock,
}));

describe('/ (welcome) setup continuation', () => {
    beforeEach(() => {
        vi.resetModules();
        isAuthenticated = true;
        activeServerState.value = {
            serverId: 'server-a',
            serverUrl: 'http://server-a.local',
            generation: 1,
        };
        routeParamsState.value = {};
        expoRouterMock.resetParams();
        tauriDesktopState.value = true;
        connectionHealthState.value = 0;
        pendingTerminalConnectState.value = null;
        relayDriftBannerState.value = null;
        getPendingSetupIntentMock.mockReset();
        getPendingSetupIntentMock.mockReturnValue({
            branch: 'thisComputer',
            phase: 'awaiting_auth',
            relayUrl: 'https://relay.example.test',
        });
        clearPendingSetupIntentMock.mockReset();
        setPendingSetupIntentMock.mockReset();
        applyLocalSettingsSpy.mockReset();
        localDaemonStatus.value = {
            serviceInstalled: false,
            daemonRunning: false,
            needsAuth: true,
            machineId: null,
        };
        expoRouterMock.spies.replace.mockReset();
        expoRouterMock.spies.push.mockReset();
    });

    afterEach(() => {
        standardCleanup();
        globalThis.localStorage?.removeItem('happier.voice.e2e.fixture');
    });

    it.each([
        ['thisComputer', 'awaiting_auth', 'thisComputer'],
        ['remoteMachine', 'post_auth', 'ssh'],
    ] as const)('routes an explicit %s intent once to the draft', async (branch, phase, path) => {
        getPendingSetupIntentMock.mockReturnValue({ branch, phase, relayUrl: 'https://relay.example.test' });
        const Screen = (await import('@/app/(app)/index')).Home;
        const screen = await renderScreen(<React.StrictMode><Screen /></React.StrictMode>);
        await flushHookEffects({ cycles: 1, turns: 2 });
        expect(expoRouterMock.spies.replace.mock.calls.filter(([href]) => href === `/settings/machines/add?path=${path}`)).toHaveLength(1);
        expect(clearPendingSetupIntentMock).toHaveBeenCalled();
        expect(screen.findAllByType('MainView' as never)).toHaveLength(1);
        expect(screen.findAllByType('BaseModal' as never)).toHaveLength(0);
    });

    it.each(['pre_auth', 'dismissed'] as const)('leaves a %s intent alone', async (phase) => {
        getPendingSetupIntentMock.mockReturnValue({ branch: 'thisComputer', phase, relayUrl: null });
        const Screen = (await import('@/app/(app)/index')).Home;
        await renderScreen(<Screen />);
        await flushHookEffects({ cycles: 1, turns: 2 });
        expect(expoRouterMock.spies.replace).not.toHaveBeenCalled();
        expect(clearPendingSetupIntentMock).not.toHaveBeenCalled();
    });

    it.each([true, false])('does not seed automatic setup on desktop=%s', async (desktop) => {
        tauriDesktopState.value = desktop;
        getPendingSetupIntentMock.mockReturnValue(null);
        const Screen = (await import('@/app/(app)/index')).Home;
        const screen = await renderScreen(<Screen />);
        await flushHookEffects({ cycles: 1, turns: 2 });
        expect(screen.findAllByType('MainView' as never)).toHaveLength(1);
        expect(expoRouterMock.spies.replace).not.toHaveBeenCalled();
        expect(setPendingSetupIntentMock).not.toHaveBeenCalled();
    });

    it('gives a session deep link precedence without consuming setup', async () => {
        routeParamsState.value = { id: 'session-1' };
        const Screen = (await import('@/app/(app)/index')).Home;
        await renderScreen(<Screen />);
        await flushHookEffects({ cycles: 1, turns: 2 });
        expect(expoRouterMock.spies.replace).not.toHaveBeenCalledWith('/settings/machines/add?path=thisComputer');
        expect(clearPendingSetupIntentMock).not.toHaveBeenCalled();
    });

    it('resumes a signed-out explicit Home new-session continuation after that Home authenticates', async () => {
        getPendingSetupIntentMock.mockReturnValue(null);
        activeServerState.value = {
            serverId: 'server-b',
            serverUrl: 'http://server-b.local',
            generation: 2,
        };
        routeParamsState.value = {
            newSessionAuthContinuation: '1',
            spawnServerId: 'server-b',
            draftId: 'draft-1',
        };

        const Screen = (await import('@/app/(app)/index')).Home;
        await renderScreen(React.createElement(Screen));
        await flushHookEffects({ cycles: 1, turns: 2 });

        expect(expoRouterMock.spies.replace).toHaveBeenCalledWith({
            pathname: '/new',
            params: expect.objectContaining({
                spawnServerId: 'server-b',
                draftId: 'draft-1',
            }),
        });
    });

    it('does not resume an explicit Home continuation against a different active Home', async () => {
        getPendingSetupIntentMock.mockReturnValue(null);
        routeParamsState.value = {
            newSessionAuthContinuation: '1',
            spawnServerId: 'server-b',
            draftId: 'draft-1',
        };

        const Screen = (await import('@/app/(app)/index')).Home;
        await renderScreen(React.createElement(Screen));
        await flushHookEffects({ cycles: 1, turns: 2 });

        expect(expoRouterMock.spies.replace).not.toHaveBeenCalledWith(expect.objectContaining({
            pathname: '/new',
        }));
    });

    it('renders the real Desktop shell after the Personal Home provider releases readiness', async () => {
        isAuthenticated = false;
        getPendingSetupIntentMock.mockReturnValue(null);

        const Screen = (await import('@/app/(app)/index')).Home;
        const screen = await renderScreen(React.createElement(Screen));
        await flushHookEffects({ cycles: 1, turns: 2 });

        expect(screen.findAllByType('MainView' as never)).toHaveLength(1);
        expect(screen.findAllByType('PreAuthOnboardingWizardEntry' as never)).toHaveLength(0);
    });

    it('keeps verified Home plus profile-adoption retry in the real provider/index shell', async () => {
        isAuthenticated = false;
        getPendingSetupIntentMock.mockReturnValue(null);
        const verifiedUnadopted: PersonalHomeFacts = {
            hostIsDesktop: true,
            isDesktopMainWindow: true,
            explicitlySelectedOtherHome: false,
            completedPersonalHomeProfile: null,
            candidateLocalProfile: {
                id: 'local', name: 'Personal Home', serverUrl: 'http://127.0.0.1:43123',
                serverIdentityId: 'personal-home-identity', createdAt: 1, updatedAt: 1, lastUsedAt: 1,
            },
            relayRuntime: {
                relayUrl: 'http://127.0.0.1:43123',
                installed: true,
                healthy: true,
                serviceActive: true,
                status: 'healthy',
                purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
                anonymousSignupEnabled: false,
            },
            localHomeReachability: 'reachable',
            localHomeIdentity: 'personal-home-identity',
            localHomeAuth: 'present',
            anonymousSignup: 'disabled',
            daemon: null,
            activeTask: null,
        };
        const Screen = (await import('@/app/(app)/index')).Home;
        const { PersonalHomeBootstrapGate } = await import('@/components/personalHome/bootstrap/PersonalHomeBootstrapGate');
        const screen = await renderScreen(
            <PersonalHomeBootstrapGate
                isDesktopHost
                isDesktopMainWindow
                initialFacts={verifiedUnadopted}
                readFacts={async () => verifiedUnadopted}
                operations={{ 'ensure-home-ready': async () => { throw new Error('profile store unavailable'); } }}
            >
                <Screen />
            </PersonalHomeBootstrapGate>,
        );
        await flushHookEffects({ cycles: 6, turns: 3 });

        expect(screen.findAllByType('MainView' as never)).toHaveLength(1);
        expect(screen.findAllByType('PreAuthOnboardingWizardEntry' as never)).toHaveLength(0);
        expect(screen.findByTestId('personal-home-recovery-strip')).not.toBeNull();
    });

    it('does not auto-open the setup wizard overlay on web when a voice e2e fixture query param is present', async () => {
        tauriDesktopState.value = false;
        connectionHealthState.value = 0;
        getPendingSetupIntentMock.mockReturnValue(null);

        // The UI e2e harness drives the voice surface via `?happier_voice_e2e_fixture=...`.
        expoRouterMock.state.router.setParams({ happier_voice_e2e_fixture: 'local_auto_return_listening' });

        const Screen = (await import('@/app/(app)/index')).Home;
        const screen = await renderScreen(React.createElement(Screen));
        await flushHookEffects({ cycles: 1, turns: 3 });

        expect(setPendingSetupIntentMock).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'post_auth' }));
    });

    it('suppresses the setup wizard overlay on web when a voice e2e fixture query param is present, even if a setup auth continuation is pending', async () => {
        tauriDesktopState.value = false;
        connectionHealthState.value = 0;
        getPendingSetupIntentMock.mockReturnValue({
            branch: 'thisComputer',
            phase: 'awaiting_auth',
            relayUrl: 'https://relay.example.test',
        });
        expoRouterMock.state.router.setParams({ happier_voice_e2e_fixture: 'local_auto_return_listening' });

        const Screen = (await import('@/app/(app)/index')).Home;
        const screen = await renderScreen(React.createElement(Screen));
        await flushHookEffects({ cycles: 1, turns: 3 });

        expect(setPendingSetupIntentMock).toHaveBeenCalledWith(expect.objectContaining({ phase: 'dismissed' }));
    });

    it('does not auto-open the setup wizard overlay on web when a voice e2e fixture is persisted in localStorage', async () => {
        tauriDesktopState.value = false;
        connectionHealthState.value = 0;
        getPendingSetupIntentMock.mockReturnValue(null);
        globalThis.localStorage?.setItem('happier.voice.e2e.fixture', 'local_auto_return_listening');

        const Screen = (await import('@/app/(app)/index')).Home;
        const screen = await renderScreen(React.createElement(Screen));
        await flushHookEffects({ cycles: 1, turns: 3 });

        expect(setPendingSetupIntentMock).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'post_auth' }));
    });

    it('does not open the setup wizard overlay during a voice e2e fixture even when a setup continuation is pending', async () => {
        tauriDesktopState.value = false;
        connectionHealthState.value = 0;
        getPendingSetupIntentMock.mockReturnValue({
            branch: 'thisComputer',
            phase: 'awaiting_auth',
            relayUrl: 'https://relay.example.test',
        });
        globalThis.localStorage?.setItem('happier.voice.e2e.fixture', 'local_auto_return_listening');

        const Screen = (await import('@/app/(app)/index')).Home;
        const screen = await renderScreen(React.createElement(Screen));
        await flushHookEffects({ cycles: 1, turns: 3 });

    });

    it('ignores voice fixture query markers in production without dismissing setup', async () => {
        const previousDev = (globalThis as { __DEV__?: boolean }).__DEV__;
        const previousDebug = process.env.EXPO_PUBLIC_DEBUG;
        (globalThis as { __DEV__?: boolean }).__DEV__ = false;
        process.env.EXPO_PUBLIC_DEBUG = '0';
        tauriDesktopState.value = false;
        expoRouterMock.state.router.setParams({ happier_voice_e2e_fixture: 'local_auto_return_listening' });

        try {
            const Screen = (await import('@/app/(app)/index')).Home;
            const screen = await renderScreen(React.createElement(Screen));
            await flushHookEffects({ cycles: 1, turns: 3 });

            expect(expoRouterMock.spies.replace).toHaveBeenCalledWith('/settings/machines/add?path=thisComputer');
            expect(setPendingSetupIntentMock).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'dismissed' }));
        } finally {
            (globalThis as { __DEV__?: boolean }).__DEV__ = previousDev;
            if (previousDebug === undefined) delete process.env.EXPO_PUBLIC_DEBUG;
            else process.env.EXPO_PUBLIC_DEBUG = previousDebug;
        }
    });

    it('ignores persisted voice fixture markers in production without dismissing setup', async () => {
        const previousDev = (globalThis as { __DEV__?: boolean }).__DEV__;
        const previousDebug = process.env.EXPO_PUBLIC_DEBUG;
        (globalThis as { __DEV__?: boolean }).__DEV__ = false;
        process.env.EXPO_PUBLIC_DEBUG = '0';
        tauriDesktopState.value = false;
        globalThis.localStorage?.setItem('happier.voice.e2e.fixture', 'local_auto_return_listening');

        try {
            const Screen = (await import('@/app/(app)/index')).Home;
            const screen = await renderScreen(React.createElement(Screen));
            await flushHookEffects({ cycles: 1, turns: 3 });

            expect(expoRouterMock.spies.replace).toHaveBeenCalledWith('/settings/machines/add?path=thisComputer');
            expect(setPendingSetupIntentMock).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'dismissed' }));
        } finally {
            (globalThis as { __DEV__?: boolean }).__DEV__ = previousDev;
            if (previousDebug === undefined) delete process.env.EXPO_PUBLIC_DEBUG;
            else process.env.EXPO_PUBLIC_DEBUG = previousDebug;
        }
    });

    it('does not open the post-auth setup wizard while a terminal connect approval is pending', async () => {
        tauriDesktopState.value = false;
        pendingTerminalConnectState.value = {
            publicKeyB64Url: 'abc123',
            serverUrl: 'https://relay.example.test',
        };

        const Screen = (await import('@/app/(app)/index')).Home;
        const screen = await renderScreen(React.createElement(Screen));
        await flushHookEffects({ cycles: 1, turns: 3 });

        expect(setPendingSetupIntentMock).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'post_auth' }));
    });
});

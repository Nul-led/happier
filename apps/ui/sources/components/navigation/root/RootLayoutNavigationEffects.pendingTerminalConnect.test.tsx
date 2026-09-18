import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const replaceSpy = vi.fn();
let isAuthenticated = false;

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        pathname: '/',
        segments: ['(app)'],
        router: { replace: replaceSpy },
    }).module;
});

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'web' } });
});

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated, refreshFromActiveServer: vi.fn(async () => {}) }),
}));

vi.mock('@/sync/domains/pending/pendingTerminalConnect', async () => (
    await import('@/sync/domains/pending/pendingTerminalConnect.web')
));

vi.mock('@/hooks/ui/useWebInitialRouteReconcile', () => ({ useWebInitialRouteReconcile: () => {} }));
vi.mock('@/sync/domains/server/url/consumeLegacySessionDeepLinkFromWebLocation', () => ({
    consumeLegacySessionDeepLinkFromWebLocation: () => false,
}));
vi.mock('@/activity/notifications/runtime/useNotificationResponseRouting', () => ({
    useNotificationResponseRouting: () => {},
}));
vi.mock('@/activity/adapters/desktop/runtime/isDesktopActivityOverlayWindowContext', () => ({
    isDesktopActivityOverlayWindowContext: () => false,
}));
vi.mock('@/utils/platform/desktopHost', () => ({
    invokeDesktopHost: vi.fn(),
    isDesktopHost: () => false,
}));
vi.mock('@/components/ui/text/Text', () => ({ Text: 'Text' }));

function createStorage(): Storage {
    const values = new Map<string, string>();
    return {
        get length() { return values.size; },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => { values.delete(key); },
        setItem: (key, value) => { values.set(key, value); },
    };
}

afterEach(() => {
    standardCleanup();
    isAuthenticated = false;
    replaceSpy.mockClear();
    vi.unstubAllGlobals();
});

it('resumes a real pre-auth capture when the authenticated account scope hydrates', async () => {
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
    const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
    const { createServerAccountScope } = await import('@/sync/domains/scope/serverAccountScope');
    const { storage } = await import('@/sync/domains/state/storage');
    const { setPendingTerminalConnect } = await import('@/sync/domains/pending/pendingTerminalConnect.web');
    const { RootLayoutNavigationEffects } = await import('./RootLayoutNavigationEffects');

    const server = upsertAndActivateServer({
        serverUrl: 'https://stack.example.test',
        source: 'manual',
        scope: 'device',
        replaceEquivalentStoredUrl: true,
    });
    setPendingTerminalConnect({
        publicKeyB64Url: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        serverUrl: 'https://stack.example.test',
        serverIdentityId: 'srv_stack',
        pairing: {
            secretB64Url: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
            createdAtMs: 1_900_000_000_000,
            expiresAtMs: 1_900_000_060_000,
        },
        homeConnectionDescriptor: {
            v: 1,
            homeServerIdentityId: 'srv_stack',
            canonicalServerUrl: 'https://stack.example.test',
            revision: 1,
            endpoints: [{ kind: 'https', url: 'https://stack.example.test' }],
        },
    });

    const rendered = await renderScreen(<RootLayoutNavigationEffects />);
    isAuthenticated = true;
    await act(async () => rendered.tree.update(<RootLayoutNavigationEffects />));
    expect(replaceSpy).not.toHaveBeenCalled();

    const scope = createServerAccountScope(server.id, 'account-a');
    expect(scope).not.toBeNull();
    await act(async () => storage.getState().activateProfileScope(scope!));

    expect(replaceSpy).toHaveBeenCalledWith(expect.stringContaining('/terminal/connect#v4='));
});

import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

const routeState = vi.hoisted(() => ({
    params: {} as Record<string, string>,
    replace: vi.fn(),
}));
const serverState = vi.hoisted(() => ({
    carrier: null as null | { endpointId: string },
}));
const authState = vi.hoisted(() => ({
    isAuthenticated: true,
    refreshFromActiveServer: vi.fn(async () => {}),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return await createReactNativeWebMock({
        useWindowDimensions: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
    });
});

vi.mock('expo-router', () => ({
    router: { replace: routeState.replace },
    useLocalSearchParams: () => routeState.params,
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => authState,
}));

vi.mock('@/modal/components/BaseModal', () => ({
    BaseModal: (props: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('BaseModal', props, props.children),
}));

vi.mock('@/components/onboarding/surfaces/SetupWizardSurface', () => ({
    SetupWizardSurface: (props: Record<string, unknown>) => React.createElement('SetupWizardSurface', props),
}));

vi.mock('@/components/navigation/accountEntry/AuthenticatedAccountEntryRouteSurface', () => ({
    AuthenticatedAccountEntryRouteSurface: (props: Record<string, unknown>) =>
        React.createElement('AuthenticatedAccountEntryRouteSurface', props),
}));

vi.mock('@/sync/store/settingsWriters', () => ({ useApplyLocalSettings: () => vi.fn() }));
vi.mock('@/sync/domains/pending/pendingSetupIntent', () => ({ clearPendingSetupIntent: vi.fn() }));
vi.mock('@/utils/platform/desktopHost', () => ({ isDesktopHost: () => false }));
vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'home-l2', serverUrl: 'https://home-l2.example.test', runtimeOrigin: null }),
}));
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerHomeCarrier: () => serverState.carrier,
    getServerProfileById: () => ({
        id: 'home-l2',
        serverUrl: 'https://home-l2.example.test',
        serverIdentityId: 'srv_home_l2',
    }),
}));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

import SetupWizardRoute from '@/app/(app)/setup/wizard';

describe('SetupWizardRoute account entry', () => {
    beforeEach(() => {
        routeState.params = {};
        routeState.replace.mockClear();
        serverState.carrier = null;
        authState.isAuthenticated = true;
        authState.refreshFromActiveServer.mockClear();
    });

    it('mounts the bounded account journey without mounting machine setup', async () => {
        routeState.params = {
            mode: 'account-entry',
            accountServiceEndpoint: 'https://accounts.example.test',
            accountServiceIdentity: 'srv_accounts',
            accountIntent: JSON.stringify({ kind: 'enter', target: { kind: 'automatic' } }),
            accountEntryReturnTo: '/',
        };
        const screen = await renderScreen(<SetupWizardRoute />);

        expect(screen.findByType('AuthenticatedAccountEntryRouteSurface').props.request).toEqual({
            service: { endpointUrl: 'https://accounts.example.test', serverIdentityId: 'srv_accounts' },
            intent: { kind: 'enter', target: { kind: 'automatic' } },
            returnTo: '/',
        });
        expect(screen.findByType('AuthenticatedAccountEntryRouteSurface').props.routeParams).toBe(routeState.params);
        expect(screen.findAllByType('SetupWizardSurface')).toHaveLength(0);
    });

    it('reacquires an active Home carrier only when service URL and stable identity both match', async () => {
        serverState.carrier = { endpointId: 'carrier-l2' };
        routeState.params = {
            mode: 'account-entry',
            accountServiceEndpoint: 'https://home-l2.example.test',
            accountServiceIdentity: 'srv_home_l2',
            accountIntent: JSON.stringify({ kind: 'link', homeServerIdentityId: 'srv_home_l2' }),
            accountEntryReturnTo: '/',
        };
        const screen = await renderScreen(<SetupWizardRoute />);

        expect(screen.findByType('AuthenticatedAccountEntryRouteSurface').props.transport)
            .toEqual({ homeCarrier: serverState.carrier });
    });

    it('mounts an OAuth callback with its custody-validated original shell destination', async () => {
        routeState.params = {
            mode: 'account-entry',
            accountServiceEndpoint: 'https://accounts.example.test',
            accountServiceIdentity: 'srv_accounts',
            accountIntent: JSON.stringify({ kind: 'link', homeServerIdentityId: 'srv_home_l2' }),
            accountServiceReturn: '1',
            accountEntryReturnTo: '/settings/account',
        };
        const screen = await renderScreen(<SetupWizardRoute />);

        expect(screen.findByType('AuthenticatedAccountEntryRouteSurface').props.request).toEqual({
            service: { endpointUrl: 'https://accounts.example.test', serverIdentityId: 'srv_accounts' },
            intent: { kind: 'link', homeServerIdentityId: 'srv_home_l2' },
            returnTo: '/settings/account',
        });
        expect(screen.findByType('AuthenticatedAccountEntryRouteSurface').props.routeParams).toBe(routeState.params);
    });

    it('keeps the canonical Account callback route mounted before Home authentication', async () => {
        authState.isAuthenticated = false;
        routeState.params = {
            mode: 'account-entry',
            accountServiceEndpoint: 'https://accounts.example.test',
            accountServiceIdentity: 'srv_accounts',
            accountIntent: JSON.stringify({ kind: 'enter', target: { kind: 'explicit', homeServerIdentityId: 'srv_home_l2' } }),
            accountServiceReturn: '1',
            accountEntryReturnTo: '/',
        };
        const screen = await renderScreen(<SetupWizardRoute />);

        expect(screen.findByType('AuthenticatedAccountEntryRouteSurface').props.request.intent).toEqual({
            kind: 'enter',
            target: { kind: 'explicit', homeServerIdentityId: 'srv_home_l2' },
        });
        expect(routeState.replace).not.toHaveBeenCalledWith('/');
    });

    it('fails malformed or secret-bearing account routes closed instead of opening setup', async () => {
        routeState.params = {
            mode: 'account-entry',
            accountServiceEndpoint: 'https://accounts.example.test',
            accountServiceIdentity: 'srv_accounts',
            accountIntent: JSON.stringify({ kind: 'enter', target: { kind: 'automatic' } }),
            accountServiceReturn: '1',
            accountEntryReturnTo: '/',
            token: 'must-not-cross-route',
        };
        const screen = await renderScreen(<SetupWizardRoute />);

        await vi.waitFor(() => expect(routeState.replace).toHaveBeenCalledWith('/'));
        expect(screen.findAllByType('AuthenticatedAccountEntryRouteSurface')).toHaveLength(0);
        expect(screen.findAllByType('SetupWizardSurface')).toHaveLength(0);
    });

    it('keeps the existing machine setup branch for ordinary setup params', async () => {
        routeState.params = { action: 'local', step: 'setup_this_computer', scope: 'machine' };
        const screen = await renderScreen(<SetupWizardRoute />);

        expect(screen.findByType('SetupWizardSurface').props).toMatchObject({
            initialStepId: 'setup_this_computer',
            initialSetupAction: 'local',
            scope: 'machine',
        });
        expect(screen.findAllByType('AuthenticatedAccountEntryRouteSurface')).toHaveLength(0);
    });
});

import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';

const acquireAccountServiceAuthTransport = vi.hoisted(() => vi.fn());
const fetchHomeAuthEntry = vi.hoisted(() => vi.fn());
const useServerFeaturesSnapshotForServerId = vi.hoisted(() => vi.fn());
const getServerFeaturesSnapshot = vi.hoisted(() => vi.fn());
const profileState = vi.hoisted(() => ({
    profile: {
        id: 'profile-selected',
        name: 'Selected Home',
        serverUrl: 'https://selected.example.test',
        serverIdentityId: 'home-selected',
    } as { id: string; name: string; serverUrl: string; serverIdentityId?: string } | null,
}));

// Transport, auth-entry and feature probes are this surface's network boundaries.
vi.mock('@/auth/accountDirectory/accountDirectoryAuthClient', () => ({ acquireAccountServiceAuthTransport }));
vi.mock('@/auth/entry/authEntryClient', () => ({ fetchHomeAuthEntry }));
vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({ useServerFeaturesSnapshotForServerId }));
vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({ getServerFeaturesSnapshot }));
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>(),
    getServerProfileById: (profileRef: string) => (
        profileRef === profileState.profile?.id ? profileState.profile : null
    ),
    resolveServerProfileScopeId: (profile: { id: string; serverIdentityId?: string }) => profile.serverIdentityId ?? profile.id,
}));
vi.mock('@/components/ui/surfaces/SurfaceStateCard', () => ({
    SurfaceStateCard: (props: Record<string, unknown>) => React.createElement('SurfaceStateCard', props),
}));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});
vi.mock('./HomeAuthenticationFlow', () => ({
    HomeAuthenticationFlow: (props: Record<string, unknown>) => React.createElement('HomeAuthenticationFlow', props),
}));

import { HomeRecoveryAuthenticationFlow } from './HomeRecoveryAuthenticationFlow';

const READY_PROJECTION = {
    v: 1,
    state: 'ready',
    scope: { kind: 'home' },
    actions: [{
        kind: 'authenticate',
        methodId: 'key_challenge',
        action: 'login',
        mode: 'keyed',
        origin: 'home',
        presentation: { displayName: 'Home key' },
    }],
    autoRedirect: null,
};

function renderRecovery() {
    return renderScreen(<HomeRecoveryAuthenticationFlow
        profileRef="profile-selected"
        returnTo="/session/session-1"
        onAuthenticated={vi.fn()}
        onBack={vi.fn()}
    />);
}

describe('HomeRecoveryAuthenticationFlow', () => {
    beforeEach(() => {
        profileState.profile = {
            id: 'profile-selected',
            name: 'Selected Home',
            serverUrl: 'https://selected.example.test',
            serverIdentityId: 'home-selected',
        };
        acquireAccountServiceAuthTransport.mockReset();
        acquireAccountServiceAuthTransport.mockResolvedValue({
            transport: { runtimeOrigin: 'http://127.0.0.1:43123' },
            close: vi.fn(async () => {}),
        });
        fetchHomeAuthEntry.mockReset();
        fetchHomeAuthEntry.mockResolvedValue({ kind: 'ready', projection: READY_PROJECTION });
        useServerFeaturesSnapshotForServerId.mockReset();
        getServerFeaturesSnapshot.mockReset();
        useServerFeaturesSnapshotForServerId.mockReturnValue({
            status: 'ready',
            features: createRootLayoutFeaturesResponse({}),
        });
    });

    it('shows the exact saved Home’s own methods even when another Home is focused', async () => {
        const screen = await renderRecovery();

        await vi.waitFor(() => expect(screen.findAllByType('HomeAuthenticationFlow')).toHaveLength(1));
        const flow = screen.findByType('HomeAuthenticationFlow');
        expect(fetchHomeAuthEntry).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'https://selected.example.test',
            serverId: 'home-selected',
            runtimeOrigin: 'http://127.0.0.1:43123',
        }));
        expect(flow.props.target).toEqual({ kind: 'saved_profile', profileRef: 'profile-selected' });
        expect(flow.props.actions).toEqual([expect.objectContaining({
            method: expect.objectContaining({ id: 'key_challenge' }),
            action: { id: 'login', mode: 'keyed' },
        })]);
        expect(flow.props.transport).toEqual({ runtimeOrigin: 'http://127.0.0.1:43123' });
        expect(flow.props.returnTo).toBe('/session/session-1');
        expect(flow.props.homeLabel).toBe('Selected Home');
    });

    it('fails closed on the unavailable card when the saved Home or its identity is gone', async () => {
        profileState.profile = { id: 'profile-selected', name: 'Selected Home', serverUrl: 'https://selected.example.test' };
        const screen = await renderRecovery();

        expect(screen.findByType('SurfaceStateCard').props.testID)
            .toBe('home-recovery-authentication-target-unavailable');
        expect(screen.findAllByType('HomeAuthenticationFlow')).toHaveLength(0);
    });

    it('names an incompatible Home and keeps Retry', async () => {
        fetchHomeAuthEntry.mockResolvedValue({ kind: 'incompatible' });
        const screen = await renderRecovery();

        await vi.waitFor(() => expect(screen.findByType('SurfaceStateCard').props.testID)
            .toBe('home-recovery-authentication-unavailable'));
        const card = screen.findByType('SurfaceStateCard');
        expect(card.props.title).toBe('welcome.serverIncompatibleTitle');
        fetchHomeAuthEntry.mockResolvedValue({ kind: 'ready', projection: READY_PROJECTION });
        await act(async () => {
            await (card.props.action as { onPress: () => void | Promise<void> }).onPress();
        });
        await vi.waitFor(() => expect(screen.findAllByType('HomeAuthenticationFlow')).toHaveLength(1));
    });

    it('forces the exact saved Home feature observation again when Retry is pressed', async () => {
        useServerFeaturesSnapshotForServerId.mockReturnValue({ status: 'unsupported', reason: 'invalid_payload' });
        getServerFeaturesSnapshot.mockResolvedValue({ status: 'ready', features: createRootLayoutFeaturesResponse({}) });
        const screen = await renderRecovery();
        const card = screen.findByType('SurfaceStateCard');
        await act(async () => {
            await (card.props.action as { onPress: () => void | Promise<void> }).onPress();
        });
        expect(getServerFeaturesSnapshot).toHaveBeenCalledWith({ serverId: 'home-selected', force: true });
    });
});

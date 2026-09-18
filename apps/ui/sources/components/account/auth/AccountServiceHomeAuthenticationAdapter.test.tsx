import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import type { AccountPostAuthInput } from '@/sync/ops/accountDirectory/completeAccountServicePostAuth';

const acquireAccountServiceAuthTransport = vi.hoisted(() => vi.fn());
const fetchHomeAuthEntry = vi.hoisted(() => vi.fn());
const useServerFeaturesSnapshotForServerId = vi.hoisted(() => vi.fn());

vi.mock('@/auth/accountDirectory/accountDirectoryAuthClient', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/auth/accountDirectory/accountDirectoryAuthClient')>(),
    acquireAccountServiceAuthTransport,
}));
vi.mock('@/auth/entry/authEntryClient', () => ({ fetchHomeAuthEntry }));
vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({ useServerFeaturesSnapshotForServerId }));
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    resolveServerProfileForPortableIdentity: () => ({
        kind: 'resolved',
        profile: {
            id: 'profile-home-a',
            serverUrl: 'https://home-a.example.test',
            canonicalServerUrl: 'https://home-a.example.test',
        },
    }),
    resolveServerProfileScopeId: () => 'home-a',
}));
vi.mock('@/components/ui/feedback/ActivitySpinner', () => ({
    ActivitySpinner: () => React.createElement('ActivitySpinner'),
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

import { AccountServiceHomeAuthenticationAdapter } from './AccountServiceHomeAuthenticationAdapter';

const input = {
    service: {
        endpointUrl: 'https://accounts.example.test',
        serverIdentityId: 'accounts',
        canonicalServerUrl: 'https://accounts.example.test',
    },
    credentialTokenDigest: 'C0jknAf55a-WIBFlxj8xId4cq00hoNQDzcbt4__9tlM',
    intent: { kind: 'enter', target: { kind: 'explicit', homeServerIdentityId: 'home-a' } },
} as unknown as AccountPostAuthInput;

describe('AccountServiceHomeAuthenticationAdapter', () => {
    beforeEach(() => {
        acquireAccountServiceAuthTransport.mockReset();
        fetchHomeAuthEntry.mockReset();
        useServerFeaturesSnapshotForServerId.mockReset();
        acquireAccountServiceAuthTransport.mockResolvedValue({
            transport: { runtimeOrigin: 'http://127.0.0.1:43123' },
            close: vi.fn(async () => {}),
        });
        useServerFeaturesSnapshotForServerId.mockReturnValue({
            status: 'ready',
            features: createRootLayoutFeaturesResponse({
                capabilities: {
                    auth: {
                        methods: [{
                            id: 'github',
                            actions: [{ id: 'login', enabled: true, mode: 'keyless' }],
                        }],
                    },
                },
            }),
        });
    });

    it('uses the exact Home auth-entry projection instead of the legacy feature catalog', async () => {
        fetchHomeAuthEntry.mockResolvedValue({
            kind: 'ready',
            projection: {
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
            },
        });

        const screen = await renderScreen(
            <AccountServiceHomeAuthenticationAdapter
                input={input}
                previous={{ kind: 'explicit_target_not_linked', homeServerIdentityId: 'home-a' }}
                homeServerIdentityId="home-a"
                returnTo="/settings/account"
                onResult={vi.fn()}
                onBack={vi.fn()}
            />,
        );

        await vi.waitFor(() => expect(fetchHomeAuthEntry).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'https://home-a.example.test',
            serverId: 'home-a',
            runtimeOrigin: 'http://127.0.0.1:43123',
        })));
        await vi.waitFor(() => expect(screen.findByType('HomeAuthenticationFlow')?.props.actions).toEqual([
            expect.objectContaining({
                method: expect.objectContaining({ id: 'key_challenge' }),
                action: { id: 'login', mode: 'keyed' },
                execution: { kind: 'key_entry' },
            }),
        ]));
        expect(screen.findByType('HomeAuthenticationFlow')?.props.accountContinuation).toMatchObject({
            credentialTokenDigest: input.credentialTokenDigest,
        });
    });

    it('uses the released feature projection only when the contextual endpoint is explicitly unsupported', async () => {
        fetchHomeAuthEntry.mockResolvedValue({ kind: 'unsupported' });

        const screen = await renderScreen(
            <AccountServiceHomeAuthenticationAdapter
                input={input}
                previous={{ kind: 'explicit_target_not_linked', homeServerIdentityId: 'home-a' }}
                homeServerIdentityId="home-a"
                returnTo="/settings/account"
                onResult={vi.fn()}
                onBack={vi.fn()}
            />,
        );

        await vi.waitFor(() => expect(screen.findByType('HomeAuthenticationFlow')?.props.actions).toEqual([
            expect.objectContaining({
                method: expect.objectContaining({ id: 'github' }),
                action: { id: 'login', mode: 'keyless' },
                execution: { kind: 'oauth', providerId: 'github', mode: 'keyless' },
            }),
        ]));
    });

    it.each(['incompatible', 'unavailable'] as const)(
        'fails closed when the contextual endpoint is %s',
        async (kind) => {
            fetchHomeAuthEntry.mockResolvedValue({ kind });

            const screen = await renderScreen(
                <AccountServiceHomeAuthenticationAdapter
                    input={input}
                    previous={{ kind: 'explicit_target_not_linked', homeServerIdentityId: 'home-a' }}
                    homeServerIdentityId="home-a"
                    returnTo="/settings/account"
                    onResult={vi.fn()}
                    onBack={vi.fn()}
                />,
            );

            await vi.waitFor(() => expect(screen.findByType('SurfaceStateCard')?.props.testID)
                .toBe('account-service-home-auth-unavailable'));
            expect(screen.findAllByType('HomeAuthenticationFlow')).toHaveLength(0);
        },
    );
});

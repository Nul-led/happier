import React from 'react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { profileDefaults } from '@/sync/domains/profiles/profile';
import { installAccountCommonModuleMocks } from './accountTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const shared = vi.hoisted(() => ({
    canOpenURL: vi.fn(async () => true),
    openURL: vi.fn(async () => true),
    setPendingExternalConnect: vi.fn(async () => true),
    clearPendingExternalConnect: vi.fn(async () => true),
    authEntryResult: { current: { kind: 'unsupported' } as any },
    fetchHomeAuthEntry: vi.fn(async () => shared.authEntryResult.current),
    activeServer: { current: { serverId: 'home-a', serverUrl: 'https://home-a.example.test', generation: 1 } },
    featuresSnapshot: {
        current: {
            status: 'ready' as const,
            features: { capabilities: { auth: { providers: {} } } },
        } as any,
    },
    routerPush: vi.fn(),
    getConnectUrlError: { current: null as Error | null },
}));

vi.mock('@/auth/entry/authEntryClient', () => ({
    fetchHomeAuthEntry: shared.fetchHomeAuthEntry,
}));

vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => shared.activeServer.current,
}));

vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({
    useServerFeaturesRuntimeSnapshot: () => shared.featuresSnapshot.current,
}));

installAccountCommonModuleMocks({
    icons: () => ({
        Ionicons: 'Ionicons',
    }),
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Linking: {
                canOpenURL: shared.canOpenURL,
                openURL: shared.openURL,
            },
        });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ confirmResult: true }).module;
    },
    router: () => ({
        useRouter: () => ({ push: shared.routerPush }),
    }),
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock();
    },
});

vi.mock('expo-image', () => ({
    Image: 'Image',
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        setPendingExternalConnect: shared.setPendingExternalConnect,
        clearPendingExternalConnect: shared.clearPendingExternalConnect,
    },
    isLegacyAuthCredentials: (credentials: unknown) => Boolean(credentials),
}));

vi.mock('@/hooks/server/useOAuthProviderConfigured', () => ({
    useOAuthProviderConfigured: () => true,
}));

vi.mock('@/sync/sync', () => ({
    sync: { refreshProfile: async () => {} },
}));

vi.mock('@/sync/api/account/apiIdentity', () => ({
    setAccountIdentityShowOnProfile: async () => {},
}));

vi.mock('@/sync/domains/state/storageStore', () => {
    const storage = {
        getState: () => ({ profile: profileDefaults }),
    };
    return { storage, getStorage: () => storage };
});

vi.mock('@/auth/providers/registry', () => ({
    normalizeProviderId: (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null),
    authProviderRegistry: [{
        id: 'github',
        displayName: 'GitHub',
        badgeIconName: 'logo-github',
        supportsProfileBadge: true,
        getExternalAuthUrl: async () => '',
        getConnectUrl: async () => 'javascript:alert(1)',
        finalizeConnect: async () => ({ token: 'replacement-token' }),
        cancelConnectPending: async () => {},
        disconnect: async () => {},
    }],
    getAuthProvider: (id: string, presentation?: { displayName?: string; badgeIconName?: string }) => ({
        id: id.trim().toLowerCase(),
        displayName: presentation?.displayName ?? id.charAt(0).toUpperCase() + id.slice(1),
        badgeIconName: presentation?.badgeIconName,
        supportsProfileBadge: false,
        getExternalAuthUrl: async () => '',
        getConnectUrl: async () => {
            if (shared.getConnectUrlError.current) throw shared.getConnectUrlError.current;
            return 'https://auth.example.test/connect';
        },
        finalizeConnect: async () => ({ token: 'replacement-token' }),
        cancelConnectPending: async () => {},
        disconnect: async () => {},
    }),
}));

let itemProps: any[] = [];
vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => {
        itemProps.push(props);
        return null;
    },
}));

describe('ProviderIdentityItems', () => {
    it('fails closed when linked-identity management metadata is absent', async () => {
        itemProps = [];
        shared.authEntryResult.current = { kind: 'ready', projection: { v: 1, state: 'ready', scope: { kind: 'home' }, actions: [], autoRedirect: null } };

        const { ProviderIdentityItems } = await import('./ProviderIdentityItems');
        await renderScreen(
            <ProviderIdentityItems
                profile={{
                    ...profileDefaults,
                    linkedProviders: [{
                        id: 'github', login: 'alice', displayName: 'Alice', avatarUrl: null,
                        profileUrl: null, showOnProfile: true,
                    }],
                }}
                credentials={{ token: 't', secret: 's' }}
                applyProfile={() => {}}
                returnTo="/settings/account"
            />,
        );

        await vi.waitFor(() => expect(itemProps.some((item) => item.detail === '@alice')).toBe(true));
        const linkedRow = itemProps.find((item) => item.detail === '@alice');
        expect(linkedRow?.onPress).toBeUndefined();
        expect(linkedRow?.rightElement).toBeUndefined();
        expect(itemProps.some((item) => String(item.title).includes('showProviderOnProfile'))).toBe(false);
    });

    it('keeps the released identity controls on a supported Home without managed integrations', async () => {
        itemProps = [];
        // An exact supported older Home: it cannot host a managed identity, so
        // absent management metadata is its normal answer rather than a fact the
        // client failed to classify.
        shared.authEntryResult.current = { kind: 'unsupported' };

        const { ProviderIdentityItems } = await import('./ProviderIdentityItems');
        await renderScreen(
            <ProviderIdentityItems
                profile={{
                    ...profileDefaults,
                    linkedProviders: [{
                        id: 'github', login: 'alice', displayName: 'Alice', avatarUrl: null,
                        profileUrl: null, showOnProfile: true,
                    }],
                }}
                credentials={{ token: 't', secret: 's' }}
                applyProfile={() => {}}
                returnTo="/settings/account"
            />,
        );

        // The catalog answer settles after the first render, so the row as the
        // user finally sees it is the last one rendered.
        const latestLinkedRow = () => [...itemProps].reverse().find((item) => item.detail === '@alice');
        await vi.waitFor(() => expect(typeof latestLinkedRow()?.rightElement?.props.onPress).toBe('function'));
        expect(itemProps.some((item) => String(item.title).includes('showProviderOnProfile'))).toBe(true);
    });

    it('renders disconnect and profile publication from independent server permissions', async () => {
        itemProps = [];
        shared.routerPush.mockClear();
        shared.authEntryResult.current = { kind: 'ready', projection: { v: 1, state: 'ready', scope: { kind: 'home' }, actions: [], autoRedirect: null } };

        const { ProviderIdentityItems } = await import('./ProviderIdentityItems');
        await renderScreen(
            <ProviderIdentityItems
                profile={{
                    ...profileDefaults,
                    linkedProviders: [{
                        id: 'workforce', login: 'alice', displayName: 'Alice', avatarUrl: null,
                        profileUrl: null, showOnProfile: false,
                    }],
                    linkedIdentityManagementV1: [{
                        v: 1,
                        providerId: 'workforce',
                        descriptor: { displayName: 'Acme Workforce', iconHint: 'shield-outline', source: 'managed' },
                        managedBy: { kind: 'team', team: { id: 'team-1', name: 'Acme' } },
                        requiredByTeams: [{ id: 'team-1', name: 'Acme' }],
                        canDisconnect: false,
                        disconnectReason: 'required_by_team',
                        canPublishProfile: true,
                        publishProfileReason: null,
                    }],
                }}
                credentials={{ token: 't', secret: 's' }}
                applyProfile={() => {}}
                returnTo="/settings/account"
            />,
        );

        await vi.waitFor(() => expect(itemProps.some((item) => item.title === 'Acme Workforce')).toBe(true));
        const linkedRow = itemProps.find((item) => item.title === 'Acme Workforce' && item.detail === '@alice');
        expect(linkedRow?.onPress).toEqual(expect.any(Function));
        expect(linkedRow?.showChevron).toBe(true);
        await act(async () => linkedRow?.onPress?.());
        expect(shared.routerPush).toHaveBeenCalledWith('/settings/teams/home-a/team-1/authentication');
        expect(linkedRow?.subtitle).toContain('Acme');
        expect(itemProps.some((item) => String(item.title).includes('showProviderOnProfile'))).toBe(true);
    });

    it('discards a stale provider projection after the selected Home changes', async () => {
        itemProps = [];
        let resolveHomeA: ((value: any) => void) | undefined;
        const homeA = new Promise((resolve) => { resolveHomeA = resolve; });
        const ready = (id: string, displayName: string) => ({
            kind: 'ready',
            projection: {
                v: 1,
                state: 'ready',
                scope: { kind: 'home' },
                actions: [{
                    kind: 'authenticate', methodId: id, action: 'connect', mode: 'either', origin: 'home',
                    presentation: { displayName },
                }],
                autoRedirect: null,
            },
        });
        shared.activeServer.current = { serverId: 'home-a', serverUrl: 'https://home-a.example.test', generation: 1 };
        shared.fetchHomeAuthEntry.mockReset();
        shared.fetchHomeAuthEntry.mockImplementationOnce(async () => await homeA);
        shared.fetchHomeAuthEntry.mockResolvedValueOnce(ready('provider-b', 'Provider B'));

        const { ProviderIdentityItems } = await import('./ProviderIdentityItems');
        const element = (
            <ProviderIdentityItems
                profile={profileDefaults}
                credentials={{ token: 't', secret: 's' }}
                applyProfile={() => {}}
                returnTo="/settings/account"
            />
        );
        const screen = await renderScreen(element);
        shared.activeServer.current = { serverId: 'home-b', serverUrl: 'https://home-b.example.test', generation: 2 };
        await act(async () => screen.update(
            <ProviderIdentityItems
                profile={profileDefaults}
                credentials={{ token: 't', secret: 's' }}
                applyProfile={() => {}}
                returnTo="/settings/account"
            />,
        ));
        await vi.waitFor(() => expect(itemProps.some((p) => p.title === 'Provider B')).toBe(true));

        itemProps = [];
        await act(async () => resolveHomeA?.(ready('provider-a', 'Provider A')));
        expect(itemProps.some((p) => p.title === 'Provider A')).toBe(false);
    });

    it('refreshes provider discovery when the current Home runtime generation changes', async () => {
        itemProps = [];
        const ready = (id: string, displayName: string) => ({
            kind: 'ready',
            projection: {
                v: 1,
                state: 'ready',
                scope: { kind: 'home' },
                actions: [{
                    kind: 'authenticate', methodId: id, action: 'connect', mode: 'either', origin: 'home',
                    presentation: { displayName },
                }],
                autoRedirect: null,
            },
        });
        shared.activeServer.current = { serverId: 'home-a', serverUrl: 'https://home-a.example.test', generation: 10 };
        shared.fetchHomeAuthEntry.mockReset();
        shared.fetchHomeAuthEntry
            .mockResolvedValueOnce(ready('provider-old', 'Provider Old'))
            .mockResolvedValueOnce(ready('provider-current', 'Provider Current'));

        const { ProviderIdentityItems } = await import('./ProviderIdentityItems');
        const props = {
            profile: profileDefaults,
            credentials: { token: 't', secret: 's' },
            applyProfile: () => {},
            returnTo: '/settings/account',
        } as const;
        const screen = await renderScreen(<ProviderIdentityItems {...props} />);
        await vi.waitFor(() => expect(itemProps.some((p) => p.title === 'Provider Old')).toBe(true));

        itemProps = [];
        shared.activeServer.current = { ...shared.activeServer.current, generation: 11 };
        await act(async () => screen.update(
            <ProviderIdentityItems {...props} returnTo="/settings/account?generation=11" />,
        ));

        await vi.waitFor(() => expect(itemProps.some((p) => p.title === 'Provider Current')).toBe(true));
        expect(shared.fetchHomeAuthEntry).toHaveBeenCalledTimes(2);
    });

    it('retains the last successful dynamic descriptors while refreshing the same Home', async () => {
        itemProps = [];
        let resolveRefresh: ((value: any) => void) | undefined;
        const refresh = new Promise((resolve) => { resolveRefresh = resolve; });
        const ready = (id: string, displayName: string) => ({
            kind: 'ready',
            projection: {
                v: 1,
                state: 'ready',
                scope: { kind: 'home' },
                actions: [{
                    kind: 'authenticate', methodId: id, action: 'connect', mode: 'either', origin: 'home',
                    presentation: { displayName },
                }],
                autoRedirect: null,
            },
        });
        shared.activeServer.current = { serverId: 'home-a', serverUrl: 'https://home-a.example.test', generation: 20 };
        shared.fetchHomeAuthEntry.mockReset();
        shared.fetchHomeAuthEntry
            .mockResolvedValueOnce(ready('provider-old', 'Provider Old'))
            .mockImplementationOnce(async () => await refresh);

        const { ProviderIdentityItems } = await import('./ProviderIdentityItems');
        const props = {
            profile: profileDefaults,
            credentials: { token: 't', secret: 's' },
            applyProfile: () => {},
            returnTo: '/settings/account',
        } as const;
        const screen = await renderScreen(<ProviderIdentityItems {...props} />);
        await vi.waitFor(() => expect(itemProps.some((p) => p.title === 'Provider Old')).toBe(true));

        itemProps = [];
        shared.activeServer.current = { ...shared.activeServer.current, generation: 21 };
        await act(async () => screen.update(
            <ProviderIdentityItems {...props} returnTo="/settings/account?generation=21" />,
        ));

        expect(itemProps.some((p) => p.title === 'Provider Old')).toBe(true);
        await act(async () => resolveRefresh?.(ready('provider-new', 'Provider New')));
        await vi.waitFor(() => expect(itemProps.some((p) => p.title === 'Provider New')).toBe(true));
    });

    it('discovers an unlinked deployment OIDC provider from the supported-old-server feature payload', async () => {
        itemProps = [];
        shared.fetchHomeAuthEntry.mockImplementation(async () => shared.authEntryResult.current);
        shared.authEntryResult.current = { kind: 'unsupported' };
        shared.featuresSnapshot.current = {
            status: 'ready',
            features: {
                capabilities: {
                    auth: {
                        providers: {
                            'corporate-oidc': {
                                enabled: true,
                                configured: true,
                                ui: { displayName: 'Corporate SSO', iconHint: 'shield-outline' },
                                restrictions: { usersAllowlist: false, orgsAllowlist: false, orgMatch: 'any' },
                                offboarding: { enabled: false, intervalSeconds: 60, mode: 'per-request-cache', source: 'oidc' },
                            },
                        },
                    },
                },
            },
        } as any;

        const { ProviderIdentityItems } = await import('./ProviderIdentityItems');
        await renderScreen(
            <ProviderIdentityItems
                profile={profileDefaults}
                credentials={{ token: 't', secret: 's' }}
                applyProfile={() => {}}
                returnTo="/settings/account"
            />,
        );

        await vi.waitFor(() => {
            const row = itemProps.find((p) => p.title === 'Corporate SSO');
            expect(row).toMatchObject({ showChevron: false });
            // Connecting is the row's inline action, not a press on the row.
            expect(row?.rightElement?.props).toMatchObject({ disabled: false });
        });
    });

    it('renders a current dynamic provider that is absent from the static UI registry', async () => {
        itemProps = [];
        shared.fetchHomeAuthEntry.mockImplementation(async () => shared.authEntryResult.current);
        shared.authEntryResult.current = {
            kind: 'ready',
            projection: {
                v: 1,
                state: 'ready',
                scope: { kind: 'home' },
                actions: [{
                    kind: 'authenticate',
                    methodId: 'acme',
                    action: 'connect',
                    mode: 'either',
                    origin: 'home',
                    presentation: { displayName: 'Acme Workforce', iconHint: 'shield-outline' },
                }],
                autoRedirect: null,
            },
        };

        const { ProviderIdentityItems } = await import('./ProviderIdentityItems');
        await renderScreen(
            <ProviderIdentityItems
                profile={profileDefaults}
                credentials={{ token: 't', secret: 's' }}
                applyProfile={() => {}}
                returnTo="/settings/account"
            />,
        );

        await vi.waitFor(() => {
            const row = itemProps.find((p) => p.title === 'Acme Workforce');
            expect(row).toMatchObject({ showChevron: false });
            // Connecting is the row's inline action, not a press on the row.
            expect(row?.rightElement?.props).toMatchObject({ disabled: false });
        });
    });

    it('keeps the canonical first presentation and connect action when later rows share a method', async () => {
        itemProps = [];
        shared.fetchHomeAuthEntry.mockImplementation(async () => shared.authEntryResult.current);
        shared.authEntryResult.current = {
            kind: 'ready',
            projection: {
                v: 1,
                state: 'ready',
                scope: { kind: 'home' },
                actions: [
                    {
                        kind: 'authenticate',
                        methodId: 'acme',
                        action: 'connect',
                        mode: 'either',
                        origin: 'home',
                        presentation: { displayName: 'Acme Workforce' },
                    },
                    {
                        kind: 'authenticate',
                        methodId: 'acme',
                        action: 'login',
                        mode: 'keyless',
                        origin: 'home',
                        presentation: { displayName: 'Conflicting later presentation' },
                    },
                ],
                autoRedirect: null,
            },
        };

        const { ProviderIdentityItems } = await import('./ProviderIdentityItems');
        await renderScreen(
            <ProviderIdentityItems
                profile={profileDefaults}
                credentials={{ token: 't', secret: 's' }}
                applyProfile={() => {}}
                returnTo="/settings/account"
            />,
        );

        await vi.waitFor(() => {
            const row = itemProps.find((p) => p.title === 'Acme Workforce');
            expect(row).toMatchObject({ showChevron: false });
            // Connecting is the row's inline action, not a press on the row.
            expect(row?.rightElement?.props).toMatchObject({ disabled: false });
        });
        expect(itemProps.some((p) => p.title === 'Conflicting later presentation')).toBe(false);
    });

    it('keeps a linked provider visible when it is absent from the current catalog', async () => {
        itemProps = [];
        shared.authEntryResult.current = {
            kind: 'ready',
            projection: {
                v: 1,
                state: 'ready',
                scope: { kind: 'home' },
                actions: [],
                autoRedirect: null,
            },
        };

        const { ProviderIdentityItems } = await import('./ProviderIdentityItems');
        await renderScreen(
            <ProviderIdentityItems
                profile={{
                    ...profileDefaults,
                    linkedProviders: [{
                        id: 'retired-sso',
                        login: 'alice',
                        displayName: 'Alice',
                        avatarUrl: null,
                        profileUrl: null,
                        showOnProfile: false,
                    }],
                }}
                credentials={{ token: 't', secret: 's' }}
                applyProfile={() => {}}
                returnTo="/settings/account"
            />,
        );

        await vi.waitFor(() => {
            expect(itemProps.find((p) => p.title === 'Retired-sso')).toMatchObject({ detail: '@alice' });
        });
    });

    it('presents provider failures through localized identity copy without exposing raw text', async () => {
        itemProps = [];
        shared.authEntryResult.current = {
            kind: 'ready',
            projection: {
                v: 1,
                state: 'ready',
                scope: { kind: 'home' },
                actions: [{
                    kind: 'authenticate',
                    methodId: 'workforce',
                    action: 'connect',
                    mode: 'either',
                    origin: 'home',
                    presentation: { displayName: 'Acme Workforce' },
                }],
                autoRedirect: null,
            },
        };

        const { HappyError } = await import('@/utils/errors/errors');
        const { Modal } = await import('@/modal');
        const { ProviderIdentityItems } = await import('./ProviderIdentityItems');
        vi.mocked(Modal.alert).mockReset();

        await renderScreen(
            <ProviderIdentityItems
                profile={profileDefaults}
                credentials={{ token: 't', secret: 's' }}
                applyProfile={() => {}}
                returnTo="/settings/account"
            />,
        );

        await vi.waitFor(() => {
            expect([...itemProps].reverse().find((item) => item.title === 'Acme Workforce')?.rightElement?.props.onPress)
                .toEqual(expect.any(Function));
        });
        const connect = () => [...itemProps].reverse()
            .find((item) => item.title === 'Acme Workforce' && typeof item.rightElement?.props.onPress === 'function')
            ?.rightElement.props.onPress();

        shared.getConnectUrlError.current = new HappyError(
            'raw provider response that must stay private',
            true,
            { code: 'workos_platform_unavailable', kind: 'server', status: 503 },
        );
        await act(async () => { await connect(); });
        expect(Modal.alert).toHaveBeenLastCalledWith(
            'common.error',
            'identityAdministration.errorProviderUnavailable',
        );

        shared.getConnectUrlError.current = new HappyError(
            'raw upstream body with customer data',
            false,
            { code: 'future_provider_failure', kind: 'server', status: 500 },
        );
        await act(async () => { await connect(); });
        expect(Modal.alert).toHaveBeenLastCalledWith(
            'common.error',
            'identityAdministration.error',
        );
        expect(vi.mocked(Modal.alert).mock.calls.flat().join('\n')).not.toContain('raw upstream');
        expect(vi.mocked(Modal.alert).mock.calls.flat().join('\n')).not.toContain('raw provider response');
        shared.getConnectUrlError.current = null;
    });

    it('clears pending connect state and blocks unsafe connect URLs', async () => {
        itemProps = [];
        shared.authEntryResult.current = { kind: 'unsupported' };
        shared.setPendingExternalConnect.mockClear();
        shared.clearPendingExternalConnect.mockClear();
        shared.canOpenURL.mockClear();
        shared.openURL.mockClear();

        const { Modal } = await import('@/modal');
        const { ProviderIdentityItems } = await import('./ProviderIdentityItems');
        vi.mocked(Modal.alert).mockReset();
        vi.mocked(Modal.confirm).mockReset();
        vi.mocked(Modal.confirm).mockResolvedValue(true);

        await renderScreen(
            <ProviderIdentityItems
                profile={profileDefaults}
                credentials={{ token: 't', secret: 's' }}
                applyProfile={() => {}}
                returnTo="/settings/account"
            />,
        );

        await vi.waitFor(() => {
            expect([...itemProps].reverse().find((p) => p.title === 'GitHub' && typeof p.rightElement?.props.onPress === 'function')).toBeTruthy();
        });
        const connectItem = [...itemProps].reverse().find((p) => p.title === 'GitHub' && typeof p.rightElement?.props.onPress === 'function');

        await act(async () => {
            await connectItem.rightElement.props.onPress();
        });

        expect(shared.setPendingExternalConnect).toHaveBeenCalledWith({ provider: 'github', returnTo: '/settings/account' });
        expect(shared.clearPendingExternalConnect).toHaveBeenCalled();
        expect(shared.canOpenURL).not.toHaveBeenCalled();
        expect(shared.openURL).not.toHaveBeenCalled();
        expect(Modal.alert).toHaveBeenCalled();
    });
});

import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';

const harness = vi.hoisted(() => ({
    tokenByServerId: new Map<string, string>(),
    credentialLookups: [] as string[],
    listeners: new Set<(event: { serverId: string; serverUrl: string; kind: 'credentials_set' | 'credentials_removed' }) => void>(),
}));

vi.mock('@/hooks/server/useServerProfilesGeneration', () => ({ useServerProfilesGeneration: () => 1 }));
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
    return {
        ...actual,
        areServerProfileIdentifiersEquivalent: (left: string, right: string) => (
            left === right || [left, right].sort().join(':') === 'local-home-b:srv-home-b'
        ),
        getServerProfileById: (serverId: string) => serverId === 'srv-home-b' || serverId === 'local-home-b'
            ? { id: 'local-home-b', serverIdentityId: 'srv-home-b', serverUrl: 'https://home-b.example.test' }
            : { id: serverId, serverUrl: `https://${serverId}.example.test` },
        resolveServerProfileScopeIdForIdentifier: (serverId: string) => serverId === 'local-home-b' ? 'srv-home-b' : serverId,
    };
});
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const { createTokenStorageModuleMock } = await import('@/dev/testkit/mocks/tokenStorage');
    return createTokenStorageModuleMock({
        importOriginal,
        tokenStorage: {
            getCredentialsForServerUrl: async (_serverUrl: string, options: { serverId?: string }) => {
                harness.credentialLookups.push(options.serverId ?? '');
                const token = harness.tokenByServerId.get(options.serverId ?? '');
                return token ? { token: `header.${Buffer.from(JSON.stringify({ sub: token })).toString('base64')}.signature` } : null;
            },
        },
        subscribeHomeCredentialMutations: () => () => undefined,
    });
});
vi.mock('@/sync/runtime/orchestration/homeAccountChange', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/runtime/orchestration/homeAccountChange')>(),
    subscribeHomeCredentialChange: (listener: (event: { serverId: string; serverUrl: string; kind: 'credentials_set' | 'credentials_removed' }) => void) => {
        harness.listeners.add(listener);
        return () => harness.listeners.delete(listener);
    },
}));

afterEach(() => {
    // Dispose render-scoped credential observers, but retain the directory
    // engine's process-lifetime observer just as production does. Clearing the
    // shared mock Set would orphan the cached engine module between tests.
    standardCleanup();
    harness.tokenByServerId.clear();
    harness.credentialLookups = [];
    storage.setState(storage.getInitialState(), true);
});

describe('useServerCredentialAccountScopes', () => {
    it('resolves each Home Account from that Home credential and immediately retires it on mutation', async () => {
        harness.tokenByServerId.set('home-a', 'account-a');
        harness.tokenByServerId.set('home-b', 'account-b');
        const { useServerCredentialAccountScopes } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopes(['home-a', 'home-b']));

        await vi.waitFor(() => expect(hook.getCurrent().get('home-b')?.accountId).toBe('account-b'));
        const oldBinding = hook.getCurrent().get('home-b')!;
        let retired = false;
        oldBinding.onRetire(() => { retired = true; });
        storage.setState((state) => ({
            ...state,
            sessionListRowsByServerId: { ...state.sessionListRowsByServerId, 'home-b': {} },
            sessionListIndexByServerId: { ...state.sessionListIndexByServerId, 'home-b': [] },
        }));

        harness.tokenByServerId.set('home-b', 'account-b-next');
        await act(async () => {
            for (const listener of harness.listeners) {
                listener({ kind: 'credentials_set', serverId: 'home-b', serverUrl: 'https://home-b.example.test' });
            }
            expect(oldBinding.isCurrent()).toBe(false);
            expect(retired).toBe(true);
        });

        await vi.waitFor(() => expect(hook.getCurrent().get('home-b')?.accountId).toBe('account-b-next'));
        expect(storage.getState().sessionListRowsByServerId['home-b']).toBeUndefined();
        expect(storage.getState().sessionListIndexByServerId['home-b']).toBeUndefined();
        expect(hook.getCurrent().get('home-a')?.accountId).toBe('account-a');
    });

    it('retires that Home Team and Group rows with the credential that authorized them', async () => {
        harness.tokenByServerId.set('home-b', 'account-b');
        const { useServerCredentialAccountScopes } = await import('./useServerCredentialAccountScopes');
        const {
            applyTeamGroupsPage,
            getTeamGroupsSnapshot,
            resetTeamsSnapshotsForTests,
        } = await import('@/sync/store/teams/teamsSnapshots');
        const { createServerAccountScope } = await import('./serverAccountScope');
        const { createTeamAddress } = await import('@/sync/domains/teams/teamAddress');
        const { teamGroupsQueryKeyV1, NO_TEAM_GROUP_CAPABILITIES_V1 } = await import('@happier-dev/protocol/teams');
        // The engine is the effectful owner that retires these rows, and every
        // Teams surface reaches the store through it; importing it here is the
        // same wiring production has rather than a test-only subscription.
        const { resetTeamsDirectoryEngineForTests } = await import('@/sync/engine/teams/teamsDirectoryEngine');

        resetTeamsDirectoryEngineForTests();
        resetTeamsSnapshotsForTests();
        const hook = await renderHook(() => useServerCredentialAccountScopes(['home-b']));
        await vi.waitFor(() => expect(hook.getCurrent().get('home-b')?.accountId).toBe('account-b'));

        const scope = createServerAccountScope('home-b', 'account-b')!;
        const address = createTeamAddress('home-b', 'team-1')!;
        const key = teamGroupsQueryKeyV1({ v: 1, teamId: 'team-1', archived: 'active' });
        applyTeamGroupsPage({
            scope,
            address,
            queryKey: key,
            items: [{
                v: 1,
                id: 'g1',
                teamId: 'team-1',
                name: 'Developers',
                description: null,
                archivedAt: null,
                memberCount: 1,
                management: { kind: 'native' },
                capabilities: NO_TEAM_GROUP_CAPABILITIES_V1,
            }],
            nextCursor: null,
            observedAt: 1,
        });
        expect(getTeamGroupsSnapshot(scope, address, key)?.data).toHaveLength(1);

        harness.tokenByServerId.set('home-b', 'account-b-next');
        await act(async () => {
            for (const listener of harness.listeners) {
                listener({ kind: 'credentials_set', serverId: 'home-b', serverUrl: 'https://home-b.example.test' });
            }
            // These rows were readable only because that credential authorized
            // them. Leaving them behind would outlive the credential and let a
            // replacing Account read the previous one's Teams and Groups.
            expect(getTeamGroupsSnapshot(scope, address, key)).toBeNull();
        });

        resetTeamsSnapshotsForTests();
    });

    it('keys a local profile request and its credential lookup by portable server identity', async () => {
        harness.tokenByServerId.set('srv-home-b', 'account-b');
        const { useServerCredentialAccountScopes } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopes(['local-home-b']));

        await vi.waitFor(() => expect(hook.getCurrent().get('srv-home-b')?.accountId).toBe('account-b'));
        expect(hook.getCurrent().has('local-home-b')).toBe(false);
        expect(harness.credentialLookups).toContain('srv-home-b');
    });
});

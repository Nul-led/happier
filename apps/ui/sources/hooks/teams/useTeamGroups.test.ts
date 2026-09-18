import { act } from 'react-test-renderer';
import { projectLegacySessionAccessCapabilitiesV1 } from '@happier-dev/protocol';
import { createSessionFixture } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import { sessionAddressKey } from '@/sync/domains/session/sessionAddress';
import { useSessionAudienceContext } from './useSessionAudienceContext';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_TEAM_GROUP_CAPABILITIES_V1, type TeamGroupV1 } from '@happier-dev/protocol/teams';

const serverFetchMock = vi.hoisted(() => vi.fn());
const runtimeFetchMock = vi.hoisted(() => vi.fn());
const getCredentialsForServerUrlMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/http/client', () => ({
    serverFetch: serverFetchMock,
}));

vi.mock('@/sync/runtime/connectivity/serverReachabilityRuntimeFetch', () => ({
    runtimeFetchWithServerReachability: runtimeFetchMock,
}));

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const { createTokenStorageModuleMock } = await import('@/dev/testkit');
    return createTokenStorageModuleMock({
        importOriginal: importOriginal as () => Promise<typeof import('@/auth/storage/tokenStorage')>,
        tokenStorage: { getCredentialsForServerUrl: getCredentialsForServerUrlMock },
    });
});

import { renderHook } from '@/dev/testkit';
import { createServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { createTeamAddress } from '@/sync/domains/teams/teamAddress';
import { setActiveServerId, upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { resetTeamsDirectoryEngineForTests } from '@/sync/engine/teams/teamsDirectoryEngine';
import {
    applyTeamGroupProjection,
    clearTeamsSnapshotsForServer,
    readTeamGroup,
    readTeamGroups,
    resetTeamsSnapshotsForTests,
} from '@/sync/store/teams/teamsSnapshots';

import { useTeamGroups } from './useTeamGroups';

function tokenForSub(sub: string): string {
    const payload = globalThis.btoa(JSON.stringify({ sub }))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
    return `e30.${payload}.signature`;
}

function group(id: string, name = `Group ${id}`): TeamGroupV1 {
    return {
        v: 1,
        id,
        teamId: 'team-1',
        name,
        description: null,
        archivedAt: null,
        memberCount: 0,
        management: { kind: 'native' },
        capabilities: NO_TEAM_GROUP_CAPABILITIES_V1,
    };
}

function page(items: TeamGroupV1[], nextCursor: string | null): Response {
    return new Response(JSON.stringify({ items, nextCursor }), { status: 200 });
}

beforeEach(() => {
    serverFetchMock.mockReset();
    runtimeFetchMock.mockReset();
    getCredentialsForServerUrlMock.mockReset();
    getCredentialsForServerUrlMock.mockResolvedValue({ token: tokenForSub('account') });
    resetTeamsSnapshotsForTests();
    resetTeamsDirectoryEngineForTests();
});

afterEach(() => {
    resetTeamsDirectoryEngineForTests();
    resetTeamsSnapshotsForTests();
    vi.clearAllMocks();
});

describe('useTeamGroups', () => {
    it('reads its rows from the shared Teams snapshot owner rather than its own pages', async () => {
        const serverId = (await upsertServerProfile({ serverUrl: 'https://home-a.example', name: 'A' })).id;
        await setActiveServerId(serverId, { scope: 'device' });
        const scope = createServerAccountScope(serverId, 'account')!;
        const address = createTeamAddress(serverId, 'team-1')!;
        runtimeFetchMock.mockImplementation(async () => page([group('g1', 'Platform')], null));

        const harness = await renderHook(() => useTeamGroups({
            scope,
            address,
            archived: 'active',
            enabled: true,
        }));

        await vi.waitFor(() => expect(harness.getCurrent().status).toBe('ready'));
        expect(harness.getCurrent().rows.map((row) => row.name)).toEqual(['Platform']);

        // The same rows are readable synchronously, without this hook, by a
        // surface that only needs the Group's label.
        expect(readTeamGroups(scope, address, 'active')?.map((row) => row.name)).toEqual(['Platform']);
        expect(readTeamGroup(scope, address, 'g1')?.name).toBe('Platform');
        // And the object the hook rendered is the object the reader returns, so
        // a label consumer and the list never diverge.
        expect(readTeamGroup(scope, address, 'g1')).toBe(harness.getCurrent().rows[0]);

        await harness.unmount();
    });

    it('keeps rows visible after its own surface unmounts and loses them with the credential', async () => {
        const serverId = (await upsertServerProfile({ serverUrl: 'https://home-b.example', name: 'B' })).id;
        await setActiveServerId(serverId, { scope: 'device' });
        const scope = createServerAccountScope(serverId, 'account')!;
        const address = createTeamAddress(serverId, 'team-1')!;
        runtimeFetchMock.mockImplementation(async () => page([group('g1')], null));

        const harness = await renderHook(() => useTeamGroups({
            scope,
            address,
            archived: 'active',
            enabled: true,
        }));
        await vi.waitFor(() => expect(harness.getCurrent().rows).toHaveLength(1));
        await harness.unmount();

        // The projection outlives the surface, which is the point: another
        // surface asking for the same Group's label must not refetch it.
        expect(readTeamGroups(scope, address, 'active')).toHaveLength(1);

        clearTeamsSnapshotsForServer(serverId);
        expect(readTeamGroups(scope, address, 'active')).toBeNull();
    });

    it('reports no rows and performs no read while disabled', async () => {
        const serverId = (await upsertServerProfile({ serverUrl: 'https://home-c.example', name: 'C' })).id;
        await setActiveServerId(serverId, { scope: 'device' });
        const scope = createServerAccountScope(serverId, 'account')!;
        const address = createTeamAddress(serverId, 'team-1')!;

        const harness = await renderHook(() => useTeamGroups({
            scope,
            address,
            archived: 'active',
            enabled: false,
        }));

        expect(harness.getCurrent().rows).toEqual([]);
        expect(harness.getCurrent().status).toBe('loading');
        expect(runtimeFetchMock).not.toHaveBeenCalled();
        await harness.unmount();
    });
});


describe('Session audience surface binding', () => {
    it('keeps same-ID Home labels separate and observes shared-cache renames without a card subscription', async () => {
        const homeA = (await upsertServerProfile({ serverUrl: 'https://audience-a.example', name: 'A' })).id;
        const homeB = (await upsertServerProfile({ serverUrl: 'https://audience-b.example', name: 'B' })).id;
        getCredentialsForServerUrlMock.mockImplementation(async (url: string) => ({
            token: tokenForSub(url.includes('audience-b') ? 'viewer-b' : 'viewer-a'),
        }));
        runtimeFetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
        const addresses = [homeA, homeB].map((serverId) => ({ serverId, sessionId: 'same-session' }));
        const scopes = [
            { serverId: homeA, accountId: 'viewer-a' },
            { serverId: homeB, accountId: 'viewer-b' },
        ];
        const session = createSessionFixture({ id: 'same-session', access: {
            role: 'recipient', level: 'view', capabilities: projectLegacySessionAccessCapabilitiesV1({ level: 'view' }),
            audienceContext: { kind: 'group', teamId: 'team-1', groupId: 'g1' },
        } });
        storage.setState({ sessionListRowsByServerId: {
            [homeA]: { [session.id]: { ...session, presence: 'online' } },
            [homeB]: { [session.id]: { ...session, presence: 'online' } },
        } });
        for (const [index, scope] of scopes.entries()) {
            applyTeamGroupProjection({ scope, address: { serverId: scope.serverId, teamId: 'team-1' },
                group: group('g1', index === 0 ? 'A group' : 'B group'), observedAt: Date.now() });
        }
        const hook = await renderHook(() => useSessionAudienceContext(addresses));
        try {
            await vi.waitFor(() => {
                expect(hook.getCurrent().labelsBySessionKey.get(sessionAddressKey(addresses[0]))).toBe('A group');
                expect(hook.getCurrent().labelsBySessionKey.get(sessionAddressKey(addresses[1]))).toBe('B group');
            });
            act(() => applyTeamGroupProjection({ scope: scopes[1], address: { serverId: homeB, teamId: 'team-1' },
                group: group('g1', 'Renamed group'), observedAt: Date.now() }));
            expect(hook.getCurrent().labelsBySessionKey.get(sessionAddressKey(addresses[1]))).toBe('Renamed group');
            expect(hook.getCurrent().labelsBySessionKey.get(sessionAddressKey(addresses[0]))).toBe('A group');
            act(() => clearTeamsSnapshotsForServer(homeB));
            expect(hook.getCurrent().labelsBySessionKey.get(sessionAddressKey(addresses[1]))).toBeNull();
        } finally {
            await hook.unmount();
            storage.setState(storage.getInitialState(), true);
        }
    });
});

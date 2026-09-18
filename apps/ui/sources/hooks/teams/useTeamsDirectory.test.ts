import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_TEAM_CAPABILITIES_V1, type TeamSummaryV1 } from '@happier-dev/protocol/teams';

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

import { tryWriteServerEnabledBitInPlace } from '@happier-dev/protocol';

import { createRootLayoutFeaturesResponse, renderHook } from '@/dev/testkit';
import {
    primeServerFeaturesSnapshot,
    resetServerFeaturesClientForTests,
} from '@/sync/api/capabilities/serverFeaturesClient';
import { setActiveServerId, upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { resetTeamsDirectoryEngineForTests } from '@/sync/engine/teams/teamsDirectoryEngine';
import { resetTeamsSnapshotsForTests } from '@/sync/store/teams/teamsSnapshots';

import { useTeamsDirectory } from './useTeamsDirectory';

function tokenForSub(sub: string): string {
    const payload = globalThis.btoa(JSON.stringify({ sub }))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
    return `e30.${payload}.signature`;
}

function team(id: string, name = `Team ${id}`, archivedAt: number | null = null): TeamSummaryV1 {
    return {
        id,
        name,
        description: null,
        logo: null,
        archivedAt,
        policy: {
            v: 1,
            sessionCreationPolicy: 'team_default',
            externalSharingPolicy: 'allowed',
            defaultSessionHistoryAccess: 'from_membership',
            admissionMode: 'invite_only',
            authenticationPolicy: null,
        },
        viewerRole: 'member',
        capabilities: NO_TEAM_CAPABILITIES_V1,
        admission: { historyChoice: { admin: 'choice', member: 'choice', guest: 'hidden' } },
    };
}

async function addHome(name: string, serverUrl: string, teamsEnabled: boolean): string {
    const id = (await upsertServerProfile({ serverUrl, name })).id;
    // The real Home payload, with only the canonical `teams` bit varied through
    // its own writer: the enabled-bit path is the feature owner's, not this
    // test's, so a moved bit fails here instead of silently reading as absent.
    const features = createRootLayoutFeaturesResponse();
    // The shared Home fixture predates this feature, so its container is seeded
    // here; the bit's location stays owned by the protocol writer, so a moved
    // enabled-bit path fails this test instead of reading as a silent absence.
    (features.features as Record<string, unknown>).teams = { enabled: false };
    expect(tryWriteServerEnabledBitInPlace(features, 'teams', teamsEnabled)).toBe(true);
    primeServerFeaturesSnapshot({ serverId: id, snapshot: { status: 'ready', features } });
    return id;
}

beforeEach(() => {
    serverFetchMock.mockReset();
    runtimeFetchMock.mockReset();
    getCredentialsForServerUrlMock.mockReset();
    getCredentialsForServerUrlMock.mockResolvedValue({ token: tokenForSub('account') });
    resetServerFeaturesClientForTests();
    resetTeamsSnapshotsForTests();
    resetTeamsDirectoryEngineForTests();
});

afterEach(() => {
    resetTeamsDirectoryEngineForTests();
    resetTeamsSnapshotsForTests();
    resetServerFeaturesClientForTests();
    vi.clearAllMocks();
});

describe('useTeamsDirectory', () => {
    it('reads each capable Home as the Account that Home is signed in as', async () => {
        const home = addHome('Home A', 'https://home-a.example', true);
        await setActiveServerId(home, { scope: 'device' });
        runtimeFetchMock.mockImplementation(async () => new Response(
            JSON.stringify({ items: [team('t1', 'Acme')], nextCursor: null }),
            { status: 200 },
        ));

        const rendered = await renderHook(() => useTeamsDirectory());
        await vi.waitFor(() => {
            expect(rendered.getCurrent().rows).toHaveLength(1);
        });

        const current = rendered.getCurrent();
        expect(current.kind).toBe('ready');
        expect(current.rows[0]?.address).toEqual({ serverId: home, teamId: 't1' });
        expect(current.rows[0]?.homeName).toBe('Home A');
        expect(runtimeFetchMock.mock.calls[0]?.[0]?.url).toBe('https://home-a.example/v1/teams/list');
        await rendered.unmount();
    });

    it('never asks a Home whose feature decision refused Teams', async () => {
        const refusing = addHome('Home B', 'https://home-b.example', false);
        await setActiveServerId(refusing, { scope: 'device' });

        const rendered = await renderHook(() => useTeamsDirectory());
        // Nothing is claimed about a Home that said no, and nothing is asked of
        // it: an admission refusal is a settled answer, not an empty directory.
        await vi.waitFor(() => expect(rendered.getCurrent().kind).toBe('loading'));
        expect(runtimeFetchMock).not.toHaveBeenCalled();
        expect(rendered.getCurrent().rows).toEqual([]);
        expect(rendered.getCurrent().unavailableHomes).toEqual([]);
        await rendered.unmount();
    });

    it('names a Home that could not answer instead of showing an empty directory', async () => {
        const home = addHome('Home A', 'https://home-a.example', true);
        await setActiveServerId(home, { scope: 'device' });
        runtimeFetchMock.mockImplementation(async () => {
            throw new Error('network down');
        });

        const rendered = await renderHook(() => useTeamsDirectory());
        await vi.waitFor(() => {
            expect(rendered.getCurrent().unavailableHomes).toHaveLength(1);
        });

        const current = rendered.getCurrent();
        expect(current.rows).toEqual([]);
        expect(current.partial).toBe(true);
        // "No Teams" would be a false statement about a Home that never answered.
        expect(current.kind).not.toBe('empty');
        expect(current.unavailableHomes[0]).toMatchObject({
            serverId: home,
            homeName: 'Home A',
            reason: 'offline',
            retryable: true,
        });
        await rendered.unmount();
    });

    it('requests the archived sequence only once that section is opened', async () => {
        const home = addHome('Home A', 'https://home-a.example', true);
        await setActiveServerId(home, { scope: 'device' });
        runtimeFetchMock.mockImplementation(async () => new Response(
            JSON.stringify({ items: [], nextCursor: null }),
            { status: 200 },
        ));

        const disabled = await renderHook(() => useTeamsDirectory({ archived: 'archived', enabled: false }));
        expect(runtimeFetchMock).not.toHaveBeenCalled();
        expect(disabled.getCurrent().kind).toBe('loading');
        await disabled.unmount();

        const opened = await renderHook(() => useTeamsDirectory({ archived: 'archived' }));
        await vi.waitFor(() => {
            expect(runtimeFetchMock).toHaveBeenCalled();
        });
        expect(JSON.parse(String(runtimeFetchMock.mock.calls[0]?.[0]?.init?.body))).toMatchObject({
            scope: 'member',
            archived: 'archived',
        });
        await opened.unmount();
    });
});

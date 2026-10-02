import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
} from '@happier-dev/protocol';
import { NO_TEAM_CAPABILITIES_V1, type TeamSummaryV1 } from '@happier-dev/protocol/teams';

const serverFetchMock = vi.hoisted(() => vi.fn());
const runtimeFetchMock = vi.hoisted(() => vi.fn());

// The Home transport is the boundary; everything above it — the plugin surface
// dispatcher, the shared Action front door, the Home family port — stays real.
vi.mock('@/sync/http/client', () => ({
    serverFetch: serverFetchMock,
    createServerFetchAtEndpoint: () => async (path: string) => {
        if (path.startsWith('/v1/account/encryption')) {
            return new Response(JSON.stringify({ mode: 'plain', updatedAt: 0 }), { status: 200 });
        }
        if (path.startsWith('/v2/account/settings')) {
            return new Response(JSON.stringify({ content: null, version: 0 }), { status: 200 });
        }
        if (path === '/v1/features') {
            return new Response(JSON.stringify({
                features: {},
                capabilities: {
                    accountStoredContentCompatibility: {
                        v: 1,
                        minimumProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                        currentProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                        declarationTransport: 'http-header-and-socket-auth-v1',
                    },
                },
            }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    },
}));

vi.mock('@/sync/runtime/connectivity/serverReachabilityRuntimeFetch', () => ({
    runtimeFetchWithServerReachability: runtimeFetchMock,
}));

// `@/auth/storage/tokenStorage` and `@/sync/domains/server/serverProfiles` are internal domain
// owners, not boundaries, and a hoisted `vi.mock` factory for the former deadlocks any suite that
// also imports `@/dev/testkit` (the barrel value-imports `TokenStorage`, so the factory's own
// dynamic import waits on an evaluation that can never finish, and module evaluation is not
// covered by any Vitest timeout). The rule and its measurement are recorded at
// `activity/badges/activityBadgeRuntimeTestHelpers.ts#installBadgeHomeIdentities`. So the Home is
// saved through its real owner and only the device credential store — the one thing that genuinely
// leaves this process — is spied on.

import { TokenStorage } from '@/auth/storage/tokenStorage';
import { standardCleanup } from '@/dev/testkit';
import { createAccountTokenForTests } from '@/dev/testkit/harness/homeGovernanceHarness';
import { createServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { resetScopedHomeActionExecutorsForTests } from '@/sync/ops/actions/scopedHomeActionExecutor';

import { createBoundPluginSurfaceController } from './boundPluginSurfaceController';

/**
 * The mounted plugin front door and the Home family.
 *
 * Every `teams.*` / `home.governance.*` id is plugin-invocable, so a trusted
 * mounted plugin may ask for one. This file proves the mount's own Home and
 * Account carry that request to the Home it was admitted under, instead of the
 * whole family answering `unsupported_action` because the default executor was
 * built with no Home port.
 */

function team(id: string, name: string): TeamSummaryV1 {
    return {
        id,
        name,
        description: null,
        logo: null,
        archivedAt: null,
        recovery: null,
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

function request(facts: Readonly<{ pluginId: string; contributionId: string; surfaceId: string }>, payload: unknown) {
    return {
        version: 1,
        requestId: 'req:executeAction',
        surface: {
            pluginId: facts.pluginId,
            contributionId: facts.contributionId,
            surfaceId: facts.surfaceId,
            placement: 'browserSurface',
            platform: 'web',
            channel: 'internal',
            resourceScope: [],
            diagnostics: [],
        },
        method: 'executeAction',
        payload,
    } as never;
}

beforeEach(() => {
    runtimeFetchMock.mockReset();
    serverFetchMock.mockReset();
    resetScopedHomeActionExecutorsForTests();
});

afterEach(() => {
    standardCleanup();
    resetScopedHomeActionExecutorsForTests();
    vi.clearAllMocks();
});

async function mountedSurface(options?: Readonly<{ current?: () => boolean }>) {
    const profile = await upsertServerProfile({
        serverUrl: 'https://home-plugin-front-door.example',
        name: 'Plugin Front Door Home',
    });
    const serverId = profile.id;
    const accountToken = createAccountTokenForTests('account-1');
    vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockImplementation(async (serverUrl: string) => (
        serverUrl === profile.serverUrl ? { token: accountToken } : null
    ));
    const scope = createServerAccountScope(serverId, 'account-1')!;
    const facts = {
        pluginId: 'acme.browser',
        contributionId: 'panel',
        surfaceId: 'surfacePlacement:acme.browser:panel',
        placement: 'browserSurface',
        platform: 'web',
        channel: 'internal',
        machineId: 'machine_1',
        serverId,
        projectionGeneration: 12,
        executionOrigin: {
            serverIdentityId: 'srv_plugin_front_door',
            materializationRef: {
                machineId: 'machine_1',
                materializationId: 'materialization-current',
                pluginId: 'acme.browser',
            },
        },
        accountLifetime: Object.freeze({
            scope,
            isCurrent: options?.current ?? (() => true),
            onRetire: () => Object.freeze({ dispose: () => {} }),
        }),
        interactionEnabled: true,
        daemonInteractionEnabled: true,
    } as const;
    return { facts, scope, serverId };
}

describe('mounted plugin surface, Home family Actions', () => {
    it('carries a Home-family read to the exact Home the mount is bound to', async () => {
        const { facts, serverId } = await mountedSurface();
        runtimeFetchMock.mockResolvedValue(new Response(
            JSON.stringify({ items: [team('t1', 'Acme')], nextCursor: null }),
            { status: 200 },
        ));
        const controller = createBoundPluginSurfaceController({ facts });

        const answer = await controller.hostApi.handleRequest(request(facts, {
            action: 'teams.list',
            input: { v: 1, scope: 'member', archived: 'active', limit: 20 },
        }));

        expect(answer).toEqual({ items: [team('t1', 'Acme')], nextCursor: null });
        expect(runtimeFetchMock).toHaveBeenCalledTimes(1);
        expect(String(runtimeFetchMock.mock.calls[0]?.[0]?.url))
            .toBe('https://home-plugin-front-door.example/v1/teams/list');
        expect(serverId).not.toBe('');
        controller.dispose();
    });

    it('refuses the same read once the mount is no longer current', async () => {
        const { facts } = await mountedSurface({ current: () => false });
        const controller = createBoundPluginSurfaceController({ facts });

        // A retired mount refuses synchronously, so the answer is awaited rather
        // than asserted as a promise.
        expect(await controller.hostApi.handleRequest(request(facts, {
            action: 'teams.list',
            input: { v: 1, scope: 'member', archived: 'active', limit: 20 },
        }))).toMatchObject({ code: 'stale_surface' });
        expect(runtimeFetchMock).not.toHaveBeenCalled();
        controller.dispose();
    });
});

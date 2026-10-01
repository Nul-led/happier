import { beforeEach, describe, expect, it, vi } from 'vitest';

const serverFetch = vi.hoisted(() => vi.fn());
const getServerFeaturesSnapshot = vi.hoisted(() => vi.fn());

vi.mock('@/sync/http/client', () => ({ serverFetch }));
vi.mock('./serverFeaturesClient', () => ({ getServerFeaturesSnapshot }));
vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'server-a', serverUrl: 'https://relay.example', generation: 1 }),
}));
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    areServerProfileIdentifiersEquivalent: (left: string, right: string) => left === right,
    getServerProfileById: () => null,
    resolveServerProfileScopeIdForIdentifier: (id: string) => id,
}));
vi.mock('@/sync/runtime/connectivity/serverReachabilityRuntimeFetch', () => ({
    runtimeFetchWithServerReachability: vi.fn(),
}));

describe('serverRetentionPolicyClient', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const { resetServerRetentionPolicyClientForTests } = await import('./serverRetentionPolicyClient');
        resetServerRetentionPolicyClientForTests();
    });

    it('uses the complete v2 policy and preserves an unknown domain id', async () => {
        getServerFeaturesSnapshot.mockResolvedValue({ status: 'unsupported', reason: 'endpoint_missing' });
        serverFetch.mockResolvedValue(new Response(JSON.stringify({
            version: 2,
            enabled: true,
            complete: true,
            domains: [{ id: 'futureDomain', policy: { mode: 'delete_older_than', days: 9 } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } }));

        const { getServerRetentionPolicy } = await import('./serverRetentionPolicyClient');
        await expect(getServerRetentionPolicy({ serverId: 'server-a' })).resolves.toEqual({
            status: 'ready',
            policy: {
                enabled: true,
                completeness: 'complete',
                domains: [{ id: 'futureDomain', policy: { mode: 'delete_older_than', days: 9 } }],
            },
        });
    });

    it('falls back to the explicitly incomplete v1 projection on older servers', async () => {
        getServerFeaturesSnapshot.mockResolvedValue({
            status: 'ready',
            features: {
                capabilities: {
                    server: {
                        retention: {
                            policyVersion: 1,
                            enabled: true,
                            sessions: { mode: 'delete_inactive', inactivityDays: 30, requires: ['updatedAt', 'lastActiveAt'] },
                        },
                    },
                },
            },
        });
        serverFetch.mockResolvedValue(new Response(null, { status: 404 }));

        const { getServerRetentionPolicy } = await import('./serverRetentionPolicyClient');
        await expect(getServerRetentionPolicy({ serverId: 'server-a' })).resolves.toMatchObject({
            status: 'ready',
            policy: {
                enabled: true,
                completeness: 'legacy_partial',
                domains: [{ id: 'sessions', policy: { mode: 'delete_inactive', inactivityDays: 30 } }],
            },
        });
    });

    it('reports a failed read, never the features snapshot, when the full policy cannot be read', async () => {
        getServerFeaturesSnapshot.mockResolvedValue({
            status: 'ready',
            features: { capabilities: { server: { retention: { policyVersion: 1, enabled: true } } } },
        });
        const { getServerRetentionPolicy } = await import('./serverRetentionPolicyClient');

        serverFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
        await expect(getServerRetentionPolicy({ serverId: 'server-a' })).resolves.toEqual({ status: 'failed' });

        serverFetch.mockRejectedValueOnce(new TypeError('network down'));
        await expect(getServerRetentionPolicy({ serverId: 'server-a', force: true })).resolves.toEqual({ status: 'failed' });
    });

    it('waits for a slow Home instead of cutting the read short', async () => {
        getServerFeaturesSnapshot.mockResolvedValue({ status: 'unsupported', reason: 'endpoint_missing' });
        // Like a real fetch, the boundary rejects when its request is aborted.
        serverFetch.mockImplementation((_path: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            setTimeout(() => resolve(new Response(JSON.stringify({
                version: 2,
                enabled: true,
                complete: true,
                domains: [{ id: 'sessionSidechainMessages', policy: { mode: 'delete_older_than', days: 7 } }],
            }), { status: 200, headers: { 'content-type': 'application/json' } })), 2_000);
        }));

        const { getServerRetentionPolicy } = await import('./serverRetentionPolicyClient');
        await expect(getServerRetentionPolicy({ serverId: 'server-a' })).resolves.toMatchObject({
            status: 'ready',
            policy: { completeness: 'complete' },
        });
    });
});

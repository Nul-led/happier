import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundaries = vi.hoisted(() => ({
    getCredentials: vi.fn(),
    requestGrant: vi.fn(),
    startTunnel: vi.fn(),
    captureAuthority: vi.fn(),
    releaseAuthority: vi.fn(),
}));

const targetToken = 'header.eyJzdWIiOiJhY2NvdW50LWIifQ.signature';

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: { getCredentialsForServerUrl: (...args: unknown[]) => boundaries.getCredentials(...args) },
}));
vi.mock('@/sync/domains/machines/peer/mediation/stream/productionRouteHttp', () => ({
    resolveTargetServer: () => ({ serverId: 'server-1', serverUrl: 'https://server.example.test' }),
    requestPeerRouteGrantV2: (...args: unknown[]) => boundaries.requestGrant(...args),
}));
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    getActiveServerAccountScope: () => ({ serverId: 'server-a', accountId: 'account-a' }),
}));
vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    getAppliedActiveServerId: () => 'server-a',
}));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/createSessionRequestWithServerScope', () => ({
    captureSessionRequestAuthorityForServerAccountScope: (...args: unknown[]) => boundaries.captureAuthority(...args),
}));
vi.mock('@/sync/domains/state/storage', () => ({
    storage: {
        getState: () => ({
            machineListByServerId: {
                'server-1': [{
                    id: 'machine-1',
                    daemonState: {
                        peerMediation: {
                            iroh: {
                                endpoint: {
                                    endpointId: 'a'.repeat(64),
                                    directAddresses: ['127.0.0.1:48123'],
                                    relayUrls: ['https://relay.example.test'],
                                },
                            },
                        },
                    },
                }],
            },
            machines: {},
        }),
    },
}));
vi.mock('@/sync/runtime/nativeIrohTunnels/machineHttpLifecycle', () => ({
    getIrohApplicationEndpoint: async () => ({ endpointId: 'b'.repeat(64) }),
    isIrohMachineHttpLifecycleAvailable: () => true,
    probeIrohMachineHttpLifecycleAvailability: async () => true,
    startIrohMachineHttpTunnel: (...args: unknown[]) => boundaries.startTunnel(...args),
}));

describe('acquireMachineCarrierHttpLease', () => {
    beforeEach(() => {
        boundaries.getCredentials.mockReset();
        boundaries.requestGrant.mockReset();
        boundaries.startTunnel.mockReset();
        boundaries.captureAuthority.mockReset();
        boundaries.releaseAuthority.mockReset();
        boundaries.getCredentials.mockResolvedValue({ token: targetToken });
        boundaries.captureAuthority.mockResolvedValue({
            scope: { serverId: 'server-1', accountId: 'account-b' },
            request: vi.fn(),
            release: boundaries.releaseAuthority,
        });
    });

    it('rejects an invalid V2 grant before native startup', async () => {
        boundaries.requestGrant.mockResolvedValueOnce({ ok: false, reasonCode: 'grant_invalid' });
        const { acquireMachineCarrierHttpLease } = await import('./machineCarrierHttpLease');

        await expect(acquireMachineCarrierHttpLease({
            operationId: 'prepared-file-1',
            machineId: 'machine-1',
            serverId: 'server-1',
            flow: 'file_transfer',
            maxBytes: 5,
        })).rejects.toThrow('grant_invalid');

        expect(boundaries.requestGrant).toHaveBeenCalledWith(expect.objectContaining({
            authority: expect.objectContaining({
                scope: { serverId: 'server-1', accountId: 'account-b' },
            }),
            request: expect.objectContaining({
                routeKind: 'iroh_peer',
                scope: expect.objectContaining({ transferId: 'prepared-file-1', maxBytes: 5 }),
                iroh: {
                    initiator: { kind: 'account_client', endpointId: 'b'.repeat(64) },
                    target: { machineId: 'machine-1', endpointId: 'a'.repeat(64) },
                    operationKind: 'file_transfer',
                },
            }),
        }));
        expect(boundaries.captureAuthority).toHaveBeenCalledWith(expect.objectContaining({
            scope: { serverId: 'server-1', accountId: 'account-b' },
        }));
        expect(boundaries.releaseAuthority).toHaveBeenCalledTimes(1);
        expect(boundaries.startTunnel).not.toHaveBeenCalled();
    });

    it('uses Home B scoped credentials while Home A is focused and takes handshake accountId from the signed grant', async () => {
        boundaries.requestGrant.mockImplementationOnce(async ({ request }) => ({
            ok: true,
            value: {
                payload: {
                    v: 2,
                    grantId: 'grant-v2',
                    accountId: 'account-from-signed-grant',
                    machineId: 'machine-1',
                    flowKind: 'bounded_transfer',
                    routeKind: 'iroh_peer',
                    scope: request.scope,
                    iat: 1_000,
                    exp: 301_000,
                    aud: 'happier-daemon-route-grant',
                    endpointFingerprint: 'a'.repeat(64),
                    proofKind: 'ephemeral_ed25519',
                    ephemeralPublicKeyBase64Url: request.ephemeralPublicKeyBase64Url,
                    iroh: request.iroh,
                },
                signature: {
                    keyId: 'key-1',
                    alg: 'Ed25519',
                    valueBase64Url: Buffer.from(new Uint8Array(64).fill(4)).toString('base64url'),
                },
            },
        }));
        boundaries.startTunnel.mockResolvedValueOnce({
            localOrigin: 'http://127.0.0.1:48124',
            requestHeaders: {},
            release: vi.fn(),
        });
        const { acquireMachineCarrierHttpLease } = await import('./machineCarrierHttpLease');

        await acquireMachineCarrierHttpLease({
            operationId: 'prepared-file-1',
            machineId: 'machine-1',
            serverId: 'server-1',
            flow: 'file_transfer',
            maxBytes: 5,
        });

        expect(boundaries.requestGrant).toHaveBeenCalledWith(expect.objectContaining({
            authority: expect.objectContaining({
                scope: { serverId: 'server-1', accountId: 'account-b' },
            }),
        }));
        expect(boundaries.getCredentials).toHaveBeenCalledWith(
            'https://server.example.test',
            { serverId: 'server-1' },
        );
        expect(boundaries.captureAuthority).toHaveBeenCalledWith(expect.objectContaining({
            scope: { serverId: 'server-1', accountId: 'account-b' },
        }));
        const tunnelInput = boundaries.startTunnel.mock.calls[0]?.[0] as { handshakeJson: string };
        expect(JSON.parse(tunnelInput.handshakeJson)).toMatchObject({ accountId: 'account-from-signed-grant' });
        expect(boundaries.releaseAuthority).toHaveBeenCalledTimes(1);
    });
});

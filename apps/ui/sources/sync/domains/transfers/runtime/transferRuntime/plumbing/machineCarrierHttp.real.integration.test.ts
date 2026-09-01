import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';

import Fastify, { type FastifyInstance } from 'fastify';
import tweetnacl from 'tweetnacl';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeaturesResponseSchema, type IrohMachineHandshakeV1 } from '@happier-dev/protocol';
import { createIrohNodeNativeModule, loadIrohNodeNativeAddon } from '@happier-dev/iroh-native/node';

import { TokenStorage } from '@/auth/storage/tokenStorage';
import { primeServerFeaturesSnapshot, resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storage';
import type { Machine } from '@/sync/domains/state/storageTypes';
import { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';
import { probeIrohMachineHttpLifecycleAvailability } from '@/sync/runtime/nativeIrohTunnels/machineHttpLifecycle';

import { FEATURE_ENV_KEYS } from '../../../../../../../../server/sources/app/features/catalog/featureEnvSchema';
import { registerPeerMediationGrantRoutes } from '../../../../../../../../server/sources/app/api/routes/machines/peer/mediation/registerPeerMediationGrantRoutes';
import { createRouteTestBuilder } from '../../../../../../../../server/sources/app/api/testkit/routeTestBuilder';
import { registerPeerMediationIrohMachineAdmissionRoute } from '../../../../../../../../cli/src/daemon/peer/mediation/loopback/irohMachineAdmission';
import { uploadBulkPayloadFromFileWithCarrierFallbacks } from './uploadBulkPayloadFromFileWithCarrierFallbacks';

const prepareDirectImportMock = vi.hoisted(() => vi.fn());
const nativeBoundary = vi.hoisted(() => ({ current: null as ReturnType<typeof createIrohNodeNativeModule> | null }));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/guardedMachineRpc', () => ({
    callGuardedMachineRpcWithPolicy: (...args: unknown[]) => prepareDirectImportMock(...args),
}));
// Expo discovery is the genuine native boundary. This is the real addon-backed
// module; route, grant, admission, lease, and transfer owners remain production.
vi.mock('@happier-dev/iroh-native', async (importOriginal) => ({
    ...await importOriginal<typeof import('@happier-dev/iroh-native')>(),
    getOptionalHappierIrohNativeModule: () => nativeBoundary.current,
}));
vi.mock('@/utils/platform/desktopHost', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/utils/platform/desktopHost')>(),
    desktopHostKind: () => null,
    isDesktopHost: () => false,
    invokeDesktopHost: () => {
        throw new Error('The real native-module fixture must not use a desktop host bridge');
    },
}));

type RelayFixtureAddon = ReturnType<typeof loadIrohNodeNativeAddon> & Readonly<{
    forceDirectOnly: () => Promise<string>;
    forceRelayOnly: () => Promise<string>;
    restoreAutomatic: () => Promise<string>;
    getTestRelayUrl: () => string | null;
}>;

type UploadResult =
    | Readonly<{ success: true; path: string; sizeBytes: number; sha256: string }>
    | Readonly<{ success: false; error: string; errorCode?: string }>;

const addonPath = process.env.HAPPIER_TEST_IROH_NODE_ADDON_PATH;
const selectedTopology = process.env.HAPPIER_MACHINE_TRANSFER_TEST_TOPOLOGY;
const describeReal = process.env.HAPPIER_RUN_MACHINE_TRANSFER_REAL_INTEGRATION === '1' && addonPath
    ? describe
    : describe.skip;

async function listen(server: HttpServer): Promise<number> {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('loopback address unavailable');
    return address.port;
}

async function close(server: HttpServer): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function readRequestBody(request: Parameters<Parameters<typeof createHttpServer>[0]>[0]): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function createRelayFallbackProbe() {
    return {
        init: vi.fn(async () => ({
            success: true as const,
            uploadId: 'forbidden-standard-fallback',
            chunkSizeBytes: 5,
            recipientPublicKeyBase64: Buffer.alloc(32, 7).toString('base64'),
        })),
        sendChunk: vi.fn(async () => ({ success: true as const })),
        finalize: vi.fn(async (): Promise<UploadResult> => ({
            success: true,
            path: '/repo/fallback.bin',
            sizeBytes: 5,
            sha256: 'sha256:fallback',
        })),
        abort: vi.fn(async () => ({ success: true as const })),
    };
}

function buildMachine(machineId: string, endpoint: Readonly<{
    endpointId: string;
    directAddresses?: readonly string[];
    relayUrls?: readonly string[];
}>): Machine {
    return {
        id: machineId,
        seq: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        active: true,
        activeAt: Date.now(),
        metadata: null,
        metadataVersion: 1,
        daemonState: { peerMediation: { iroh: { endpoint } } },
        daemonStateVersion: 1,
    };
}

describeReal('production transfer caller over native MachineHttpTunnel', () => {
    const raw = loadIrohNodeNativeAddon(addonPath!) as RelayFixtureAddon;
    const native = createIrohNodeNativeModule(raw);
    const openServers: HttpServer[] = [];
    const openFastifyApps: FastifyInstance[] = [];

    beforeEach(() => {
        nativeBoundary.current = native;
        prepareDirectImportMock.mockReset();
        resetServerFeaturesClientForTests();
        setRuntimeFetch(globalThis.fetch.bind(globalThis));
    });

    afterAll(async () => {
        nativeBoundary.current = null;
        resetRuntimeFetch();
        resetServerFeaturesClientForTests();
        await raw.restoreAutomatic();
        await Promise.all(openFastifyApps.splice(0).map(async (app) => await app.close()));
        await Promise.all(openServers.splice(0).map(close));
    });

    async function runComposedTransfer(input: Readonly<{
        topology: 'direct' | 'relay';
        transferKind: 'file' | 'attachment';
        invalidateGrant?: boolean;
    }>) {
        expect(await probeIrohMachineHttpLifecycleAvailability()).toBe(true);
        if (input.topology === 'direct') await raw.forceDirectOnly();
        else await raw.forceRelayOnly();
        const relayUrl = input.topology === 'relay' ? raw.getTestRelayUrl() : null;
        if (input.topology === 'relay' && !relayUrl) throw new Error('test relay URL unavailable');

        const receivedPayloads: string[] = [];
        const application = createHttpServer((request, response) => {
            let body = '';
            request.setEncoding('utf8');
            request.on('data', (chunk) => { body += chunk; });
            request.on('end', () => {
                if (request.url?.includes('/chunks/0')) {
                    const parsed = JSON.parse(body) as { payloadBase64?: unknown };
                    if (typeof parsed.payloadBase64 === 'string') receivedPayloads.push(parsed.payloadBase64);
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ success: true }));
                    return;
                }
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(JSON.stringify({
                    success: true,
                    finalized: { success: true, path: '/repo/payload.bin', sizeBytes: 5 },
                    sha256: 'sha256:composed-native',
                }));
            });
        });
        openServers.push(application);
        const applicationPort = await listen(application);

        const endpointRequest = {
            relayPolicy: 'automatic' as const,
            relayUrls: relayUrl ? [relayUrl] : [],
            capProfile: 'machineBulk' as const,
        };
        const target = await native.createEndpoint(endpointRequest);
        const targetStatus = await native.getEndpointStatus(target.endpointHandle);
        const directAddresses = input.topology === 'direct' ? targetStatus?.directAddresses ?? [] : [];
        const machineId = 'machine-1';
        const accountId = 'account-1';
        const accountToken = `e30.${Buffer.from(JSON.stringify({ sub: accountId })).toString('base64url')}.sig`;
        const operationId = `${input.topology}-${input.transferKind}-operation`;

        const signingKeyPair = tweetnacl.sign.keyPair();
        const signingKeyId = 'composed-grant-key';
        const route = createRouteTestBuilder({
            method: 'POST',
            path: '/v1/machines/peer/mediation/route-grants',
            registerRoutes: (app) => registerPeerMediationGrantRoutes(app, {
                env: {
                    [FEATURE_ENV_KEYS.machinesTransferDirectPeerEnabled]: 'true',
                    HAPPIER_FEATURE_MACHINES_RPC_DIRECT_PEER__ENABLED: 'true',
                    [FEATURE_ENV_KEYS.peerMediationRouteGrantSigningKeyId]: signingKeyId,
                    [FEATURE_ENV_KEYS.peerMediationRouteGrantSigningPrivateKey]: Buffer.from(signingKeyPair.secretKey).toString('base64url'),
                },
                nowMs: () => Date.now(),
                readMachineOwnershipState: async () => 'available',
                readMachineIrohEndpointAuthority: async ({ machineId: requestedMachineId }) => (
                    requestedMachineId === machineId
                        ? { endpointId: target.endpointId, revision: 1 }
                        : null
                ),
            }),
        });
        const grantRequests: unknown[] = [];
        const grantAuthorizationHeaders: Array<string | undefined> = [];
        const grantServer = createHttpServer(async (request, response) => {
            if (request.method === 'GET' && request.url === '/v1/auth/ping') {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ ok: true }));
                return;
            }
            if (request.method !== 'POST' || request.url !== '/v1/machines/peer/mediation/route-grants') {
                response.writeHead(404).end();
                return;
            }
            const body = await readRequestBody(request);
            grantRequests.push(body);
            grantAuthorizationHeaders.push(request.headers.authorization);
            const invoked = await route.invoke({ userId: accountId, body });
            const routeResponse = invoked.response as Record<string, unknown>;
            const outbound = input.invalidateGrant && routeResponse.grant && typeof routeResponse.grant === 'object'
                ? {
                    ...routeResponse,
                    grant: {
                        ...(routeResponse.grant as Record<string, unknown>),
                        signature: {
                            ...((routeResponse.grant as Record<string, unknown>).signature as Record<string, unknown>),
                            valueBase64Url: Buffer.alloc(tweetnacl.sign.signatureLength, 4).toString('base64url'),
                        },
                    },
                }
                : routeResponse;
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify(outbound));
        });
        openServers.push(grantServer);
        const grantPort = await listen(grantServer);
        const serverUrl = `http://127.0.0.1:${grantPort}`;
        const profile = upsertAndActivateServer({ serverUrl, scope: 'device' });
        const serverId = profile.id;
        const credentialsStored = await TokenStorage.setCredentialsForServerUrl(
            serverUrl,
            { serverId },
            { token: accountToken },
        );
        expect(credentialsStored).toBe(true);

        const targetDescriptor = {
            endpointId: target.endpointId,
            ...(directAddresses.length > 0 ? { directAddresses } : {}),
            ...(relayUrl ? { relayUrls: [relayUrl] } : {}),
        };
        const machine = buildMachine(machineId, targetDescriptor);
        storage.setState((state) => ({
            profileScope: { serverId, accountId },
            machines: { ...state.machines, [machineId]: machine },
            machineListByServerId: { ...state.machineListByServerId, [serverId]: [machine] },
        }));
        primeServerFeaturesSnapshot({
            serverId,
            snapshot: {
                status: 'ready',
                features: FeaturesResponseSchema.parse({
                    features: {
                        machines: {
                            enabled: true,
                            transfer: {
                                enabled: true,
                                directPeer: { enabled: true },
                                serverRouted: { enabled: true },
                            },
                        },
                    },
                    capabilities: {},
                }),
            },
        });

        const verifiedHandshakes: IrohMachineHandshakeV1[] = [];
        const admissionApp = Fastify();
        registerPeerMediationIrohMachineAdmissionRoute(admissionApp, {
            accountId,
            machineId,
            trustRoots: [{
                keyId: signingKeyId,
                publicKey: Buffer.from(signingKeyPair.publicKey).toString('base64url'),
            }],
            nowMs: () => Date.now(),
            admission: {
                localEndpointId: target.endpointId,
                role: 'acceptor',
                allowedFlows: ['file_transfer', 'attachment_transfer'],
                resolveApplicationTarget: ({ handshake }) => {
                    verifiedHandshakes.push(handshake);
                    return { port: applicationPort };
                },
            },
        });
        await admissionApp.listen({ host: '127.0.0.1', port: 0 });
        openFastifyApps.push(admissionApp);
        const admissionPort = (admissionApp.server.address() as AddressInfo).port;
        await native.startMachineAcceptor({ endpointHandle: target.endpointHandle, admissionPort });

        prepareDirectImportMock.mockResolvedValueOnce({
            success: true,
            uploadId: operationId,
            destDisplayPath: '/repo/payload.bin',
            expectedSizeBytes: 5,
            chunkSizeBytes: 5,
            recipientPublicKeyBase64: Buffer.alloc(32, 9).toString('base64'),
            expiresAt: Date.now() + 60_000,
            endpointCandidates: [{
                kind: 'http',
                url: `http://10.44.0.8:46001/machine-transfers/direct/imports/${operationId}?grant=preserved`,
                expiresAt: Date.now() + 60_000,
            }],
        });
        prepareDirectImportMock.mockResolvedValueOnce({ success: true });

        const payload = new TextEncoder().encode('hello');
        const relay = createRelayFallbackProbe();
        const result = await uploadBulkPayloadFromFileWithCarrierFallbacks<UploadResult>({
            machineId,
            serverId,
            fileReader: {
                sizeBytes: payload.byteLength,
                readBytes: async (offset, length) => payload.subarray(offset, offset + length),
                close: async () => {},
            },
            directImportRequest: input.transferKind === 'attachment'
                ? {
                    t: 'session_attachment_upload_v1',
                    workingDirectory: '/repo',
                    messageLocalId: 'message-1',
                    fileName: 'payload.bin',
                    sizeBytes: payload.byteLength,
                }
                : {
                    t: 'session_file_upload_v1',
                    workingDirectory: '/repo',
                    path: '/repo/payload.bin',
                    sizeBytes: payload.byteLength,
                    overwrite: true,
                },
            relay,
        });

        const acceptorStatus = await native.getMachineAcceptorStatus(target.endpointHandle);
        expect(
            grantRequests,
            JSON.stringify({ result, standardFallbackStarted: relay.init.mock.calls.length > 0 }),
        ).toHaveLength(1);
        expect(grantAuthorizationHeaders).toEqual([`Bearer ${accountToken}`]);
        expect(grantRequests[0]).toMatchObject({
            v: 2,
            machineId,
            flowKind: 'bounded_transfer',
            routeKind: 'iroh_peer',
            scope: { kind: 'bounded_transfer', mode: 'single', transferId: operationId, maxBytes: payload.byteLength },
            iroh: {
                initiator: { kind: 'account_client', endpointId: expect.stringMatching(/^[0-9a-f]{64}$/u) },
                target: { machineId, endpointId: target.endpointId },
                operationKind: `${input.transferKind}_transfer`,
            },
        });
        expect(relay.init).not.toHaveBeenCalled();

        if (input.invalidateGrant) {
            expect(result).toMatchObject({ success: false, errorCode: 'machine_carrier_transport_failed' });
            expect(receivedPayloads).toHaveLength(0);
            expect(verifiedHandshakes).toHaveLength(0);
            expect(acceptorStatus?.streamsAccepted).toBe(0);
            expect(acceptorStatus?.streamsRejected).toBe(1);
        } else {
            expect(result, JSON.stringify(result)).toMatchObject({ success: true, sizeBytes: payload.byteLength });
            expect(receivedPayloads).toHaveLength(1);
            expect(Buffer.from(receivedPayloads[0]!, 'base64').byteLength).toBeGreaterThan(0);
            expect(verifiedHandshakes.length).toBeGreaterThan(0);
            expect(verifiedHandshakes).toEqual(verifiedHandshakes.map((handshake) => expect.objectContaining({
                accountId,
                flow: `${input.transferKind}_transfer`,
                operationId,
            })));
            expect(acceptorStatus?.lastPath?.observedPath).toBe(input.topology);
        }

        await native.stopMachineAcceptor({ endpointHandle: target.endpointHandle });
        await native.shutdownEndpoint({ endpointHandle: target.endpointHandle });
        await admissionApp.close();
        openFastifyApps.splice(openFastifyApps.indexOf(admissionApp), 1);
        await close(application);
        await close(grantServer);
        openServers.splice(openServers.indexOf(application), 1);
        openServers.splice(openServers.indexOf(grantServer), 1);
        await TokenStorage.removeCredentialsForServerUrl(serverUrl, { serverId });

        return result;
    }

    for (const topology of ['direct', 'relay'] as const) {
        if (selectedTopology && selectedTopology !== topology) continue;
        for (const transferKind of ['file', 'attachment'] as const) {
            it(`moves nonzero ${transferKind} bytes through the production ${topology} Iroh route`, { timeout: 90_000 }, async () => {
                await runComposedTransfer({ topology, transferKind });
            });
        }
    }

    if (!selectedTopology || selectedTopology === 'direct') {
        it('rejects an invalid production-minted grant at admission without any standard fallback', { timeout: 90_000 }, async () => {
            await runComposedTransfer({ topology: 'direct', transferKind: 'file', invalidateGrant: true });
        });
    }
});

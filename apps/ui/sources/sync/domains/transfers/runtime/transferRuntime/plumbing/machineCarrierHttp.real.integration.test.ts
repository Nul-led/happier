import { createHash, randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import tweetnacl from 'tweetnacl';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    FeaturesResponseSchema,
    SignedDirectRouteGrantV2Schema,
    type IrohMachineHandshakeV1,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { createIrohNodeNativeModule, loadIrohNodeNativeAddon } from '@happier-dev/iroh-native/node';
import { createIrohTestControllerFromNativeAddon } from '@happier-dev/iroh-native/test-controller';

import { TokenStorage } from '@/auth/storage/tokenStorage';
import { primeServerFeaturesSnapshot, resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storage';
import type { Machine } from '@/sync/domains/state/storageTypes';
import { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';
import { probeIrohMachineHttpLifecycleAvailability } from '@/sync/runtime/nativeIrohTunnels/machineHttpLifecycle';

import { createBufferedTransferDestination } from '../carriers/createBufferedTransferDestination';
import { downloadBulkPayloadViaDirectExportToDestination } from './directTransferExportDownload';
import { resolveMachineCarrierRoute } from './machineCarrierHttpLease';
import { uploadBulkPayloadFromFileWithCarrierFallbacks } from './uploadBulkPayloadFromFileWithCarrierFallbacks';

import { FEATURE_ENV_KEYS } from '../../../../../../../../server/sources/app/features/catalog/featureEnvSchema';
import { registerPeerMediationGrantRoutes } from '../../../../../../../../server/sources/app/api/routes/machines/peer/mediation/registerPeerMediationGrantRoutes';
import { createRouteTestBuilder } from '../../../../../../../../server/sources/app/api/testkit/routeTestBuilder';
import { registerPeerMediationIrohMachineAdmissionRoute } from '../../../../../../../../cli/src/daemon/peer/mediation/loopback/irohMachineAdmission';
import { RpcHandlerManager } from '../../../../../../../../cli/src/api/rpc/RpcHandlerManager';
import { registerMachineDirectTransferImportRpcHandlers } from '../../../../../../../../cli/src/api/machine/rpcHandlers.directTransferImports';
import { registerMachineDirectTransferExportRpcHandlers } from '../../../../../../../../cli/src/api/machine/rpcHandlers.directTransferExports';
import { createDirectTransferServerLifecycle } from '../../../../../../../../cli/src/machines/transfer/directTransferServerLifecycle';
import { createFileTransferPayloadSource } from '../../../../../../../../cli/src/machines/transfer/transferPayloadSource';
import { resolveWorkspaceFileDownloadSource } from '../../../../../../../../cli/src/transfers/targets/resolveWorkspaceFileDownloadSource';

// The account-relayed machine RPC socket is the genuine transport boundary for prepare/abort/
// export-prepare. Everything behind it is production: the delegated invocations below run the
// real daemon RPC handler roots (registerMachineDirectTransfer*RpcHandlers) against the real
// direct-transfer server lifecycle, and every HTTP byte moves through the real native
// happier/machine/1 carrier into the production direct peer transfer app.
const machineRpcBoundary = vi.hoisted(() => ({
    current: null as null | ((method: string, payload: unknown) => Promise<unknown>),
    invocations: [] as Array<{ method: string; payload: unknown; response: unknown }>,
}));
const nativeBoundary = vi.hoisted(() => ({ current: null as ReturnType<typeof createIrohNodeNativeModule> | null }));
const machineTunnelBoundary = vi.hoisted(() => ({ calls: [] as unknown[], errors: [] as string[] }));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/guardedMachineRpc', () => ({
    callGuardedMachineRpcWithPolicy: async (params: Readonly<{ method: string; payload: unknown }>) => {
        const invoke = machineRpcBoundary.current;
        if (!invoke) throw new Error('Composed fixture target did not register production machine RPC handlers');
        const response = await invoke(params.method, params.payload);
        machineRpcBoundary.invocations.push({ method: params.method, payload: params.payload, response });
        return response;
    },
}));
// Expo discovery is the genuine native boundary. This is the real addon-backed
// module; route, grant, admission, lease, transfer, and target owners remain production.
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

type UploadResult =
    | Readonly<{ success: true; path: string; sizeBytes: number; sha256: string }>
    | Readonly<{ success: false; error: string; errorCode?: string }>;

type ExportPrepareRequest = Parameters<
    Parameters<typeof registerMachineDirectTransferExportRpcHandlers>[0]['prepareExportSession']
>[0];

const addonPath = process.env.HAPPIER_TEST_IROH_NODE_ADDON_PATH;
const selectedTopology = process.env.HAPPIER_MACHINE_TRANSFER_TEST_TOPOLOGY;
const describeReal = process.env.HAPPIER_RUN_MACHINE_TRANSFER_REAL_INTEGRATION === '1' && addonPath
    ? describe
    : describe.skip;

/** Deterministic non-uniform bytes: reordering or corrupting a chunk cannot still match. */
function createPatternedPayload(byteLength: number): Buffer {
    const payload = Buffer.alloc(byteLength);
    let state = 0x9e37_79b9;
    for (let index = 0; index < byteLength; index += 1) {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        payload[index] = state & 0xff;
    }
    return payload;
}

function expectedSha256(payload: Buffer): string {
    return createHash('sha256').update(payload).digest('hex');
}


async function reserveLoopbackPort(): Promise<number> {
    const probe = Fastify();
    try {
        await probe.listen({ host: '127.0.0.1', port: 0 });
        return (probe.server.address() as AddressInfo).port;
    } finally {
        await probe.close();
    }
}

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

/**
 * Production export-prepare composition for workspace file downloads, mirroring the daemon
 * machine bootstrap wiring: resolveWorkspaceFileDownloadSource (canonical read-target owner)
 * -> createFileTransferPayloadSource -> DirectTransferServerLifecycle.publishTransferWhenReady.
 */
function createWorkspaceFileExportPrepare(directTransferLifecycle: ReturnType<typeof createDirectTransferServerLifecycle>) {
    return async (input: ExportPrepareRequest) => {
        if (input.t !== 'workspace_file_download_v1') {
            throw new Error('Composed fixture export target supports workspace file downloads only');
        }
        const resolved = await resolveWorkspaceFileDownloadSource({
            workingDirectory: input.workingDirectory,
            path: input.path,
            asZip: input.asZip,
            sessionRpcTransferMaxBytes: null,
        });
        if (!resolved.success) {
            throw new Error(resolved.error);
        }
        const payloadSource = createFileTransferPayloadSource({
            filePath: resolved.source.filePath,
            sizeBytes: resolved.source.sizeBytes,
            name: resolved.source.name,
        });
        const published = await directTransferLifecycle.publishTransferWhenReady({
            transferId: `workspace-file-download:${randomUUID()}`,
            payloadSource,
        });
        return {
            transferId: published.transferId,
            endpointCandidates: published.endpointCandidates,
            expiresAt: published.expiresAt,
            name: resolved.source.name,
            sizeBytes: resolved.source.sizeBytes,
        };
    };
}

describeReal('production transfer caller over native MachineHttpTunnel into the production target transfer owner', () => {
    // A skipped Vitest suite still evaluates its declaration callback. Load the
    // optional native addon in the hook instead, so an ordinary UI integration
    // run can collect this file and skip it cleanly when the real-runner inputs
    // are absent.
    let testController!: ReturnType<typeof createIrohTestControllerFromNativeAddon>;
    let native!: ReturnType<typeof createIrohNodeNativeModule>;
    const openServers: HttpServer[] = [];
    const openFastifyApps: FastifyInstance[] = [];
    const endpointKeyRoots: string[] = [];
    const applicationEndpointHandles = new Set<string>();
    let applicationKeyRoot: string;
    let applicationNative: ReturnType<typeof createIrohNodeNativeModule>;

    beforeAll(async () => {
        const raw = loadIrohNodeNativeAddon(addonPath!);
        testController = createIrohTestControllerFromNativeAddon(raw);
        native = createIrohNodeNativeModule(raw);
        applicationKeyRoot = await mkdtemp(join(tmpdir(), 'happier-machine-transfer-client-'));
        endpointKeyRoots.push(applicationKeyRoot);
    });

    beforeEach(() => {
        // Use a fresh adapter object for each case so the package-owned WeakMap
        // endpoint owner cannot retain a handle after this fixture deliberately
        // shuts the native endpoint down. Production keeps one adapter and one
        // endpoint for the application process lifetime.
        applicationNative = {
            ...native,
            createEndpoint: async (input) => {
                const endpoint = await native.createEndpoint({
                    ...input,
                    keyPath: join(applicationKeyRoot, 'endpoint.key'),
                });
                applicationEndpointHandles.add(endpoint.endpointHandle);
                return endpoint;
            },
            startMachineHttpTunnel: async (input) => {
                machineTunnelBoundary.calls.push(input);
                try {
                    const result = await native.startMachineHttpTunnel!(input);
                    return result;
                } catch (error) {
                    machineTunnelBoundary.errors.push(error instanceof Error
                        ? `${error.name}: ${error.message}`
                        : String(error));
                    throw error;
                }
            },
        };
        machineTunnelBoundary.calls = [];
        machineTunnelBoundary.errors = [];
        machineRpcBoundary.current = null;
        machineRpcBoundary.invocations = [];
        nativeBoundary.current = applicationNative;
        resetServerFeaturesClientForTests();
        setRuntimeFetch(globalThis.fetch.bind(globalThis));
    });

    afterEach(async () => {
        nativeBoundary.current = null;
        for (const endpointHandle of [...applicationEndpointHandles]) {
            await native.shutdownEndpoint({ endpointHandle });
            applicationEndpointHandles.delete(endpointHandle);
        }
    });

    afterAll(async () => {
        nativeBoundary.current = null;
        machineRpcBoundary.current = null;
        resetRuntimeFetch();
        resetServerFeaturesClientForTests();
        await Promise.all(openFastifyApps.splice(0).map(async (app) => await app.close()));
        await Promise.all(openServers.splice(0).map(close));
        await testController.restoreAutomatic();
        await Promise.all(endpointKeyRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
    });

    async function runComposedTransfer(input: Readonly<{
        topology: 'direct' | 'relay';
        transferKind: 'file' | 'attachment';
        invalidateGrant?: boolean;
        declareShortSize?: boolean;
        cancelMidUpload?: boolean;
    }>) {
        expect(await probeIrohMachineHttpLifecycleAvailability()).toBe(true);
        if (input.topology === 'direct') await testController.forceDirectOnly();
        else await testController.forceRelayOnly();
        const relayUrl = input.topology === 'relay' ? testController.getTestRelayUrl() : null;
        if (input.topology === 'relay' && !relayUrl) throw new Error('test relay URL unavailable');

        const fixtureRoot = await mkdtemp(join(tmpdir(), 'happier-machine-transfer-target-owner-'));
        const targetFileRoot = join(fixtureRoot, 'target-machine-files');
        const targetAttachmentRoot = join(fixtureRoot, 'target-machine-attachment-workspace');
        const targetAttachmentWorkDir = join(fixtureRoot, 'target-machine-handler');
        await Promise.all([
            mkdir(targetFileRoot, { recursive: true }),
            mkdir(targetAttachmentRoot, { recursive: true }),
            mkdir(targetAttachmentWorkDir, { recursive: true }),
        ]);

        // Production destination transfer owner: the daemon direct-transfer server lifecycle
        // (real import session manager, AEAD chunk decryption, size limits, hash, finalize)
        // plus the production machine RPC handler roots registered on a real manager.
        const directTransferLifecycle = createDirectTransferServerLifecycle({
            bindPort: await reserveLoopbackPort(),
            bindHost: '127.0.0.1',
            listenerClasses: ['loopback_http'],
            advertisedHosts: ['127.0.0.1'],
            idleStopMs: 120_000,
        });
        const directTransferPort = await directTransferLifecycle.ensureListening();
        const rpcHandlerManager = new RpcHandlerManager({ scopePrefix: 'machine', encryptionMode: 'plain' });
        registerMachineDirectTransferImportRpcHandlers({
            rpcHandlerManager,
            prepareImportSession: directTransferLifecycle.prepareImportSession,
            abortImportSession: directTransferLifecycle.abortImportSession,
        });
        registerMachineDirectTransferExportRpcHandlers({
            rpcHandlerManager,
            prepareExportSession: createWorkspaceFileExportPrepare(directTransferLifecycle),
        });
        machineRpcBoundary.current = async (method, payload) => await rpcHandlerManager.invokeLocal(method, payload);

        const endpointRequest = {
            relayPolicy: 'automatic' as const,
            relayUrls: relayUrl ? [relayUrl] : [],
            capProfile: 'machineBulk' as const,
        };
        const targetKeyRoot = await mkdtemp(join(tmpdir(), 'happier-machine-transfer-target-'));
        endpointKeyRoots.push(targetKeyRoot);
        const target = await native.createEndpoint({
            ...endpointRequest,
            keyPath: join(targetKeyRoot, 'endpoint.key'),
        });
        const targetStatus = await native.getEndpointStatus(target.endpointHandle);
        const directAddresses = input.topology === 'direct' ? targetStatus?.directAddresses ?? [] : [];
        const machineId = 'machine-1';
        const accountId = 'account-1';
        const accountToken = `e30.${Buffer.from(JSON.stringify({ sub: accountId })).toString('base64url')}.sig`;

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
            const routeGrantParse = SignedDirectRouteGrantV2Schema.safeParse(routeResponse.grant);
            if (!routeGrantParse.success) {
                throw new Error(`Production grant route returned an invalid V2 grant: ${JSON.stringify(routeGrantParse.error.issues)}`);
            }
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
                allowedFlows: ['finite_transfer'],
                resolveApplicationTarget: ({ handshake }) => {
                    verifiedHandshakes.push(handshake);
                    return { port: directTransferPort };
                },
            },
        });
        await admissionApp.listen({ host: '127.0.0.1', port: 0 });
        openFastifyApps.push(admissionApp);
        const admissionPort = (admissionApp.server.address() as AddressInfo).port;
        await native.startMachineAcceptor({ endpointHandle: target.endpointHandle, admissionPort });

        // 512 KiB + 1: multi-chunk at the default 256 KiB target chunk size, so chunk
        // sequencing and finalization assembly are exercised on every run.
        const payload = createPatternedPayload((512 * 1024) + 1);
        const declaredSizeBytes = input.declareShortSize === true
            ? payload.byteLength - 1
            : payload.byteLength;
        const directImportRequest = input.transferKind === 'attachment'
            ? {
                t: 'session_attachment_upload_v1' as const,
                workingDirectory: targetAttachmentWorkDir,
                messageLocalId: 'message-1',
                fileName: 'composed-attachment.bin',
                sizeBytes: declaredSizeBytes,
                uploadLocation: 'workspace' as const,
                workspaceRootPath: targetAttachmentRoot,
                workspaceRelativeDir: '.happier/uploads',
            }
            : {
                t: 'session_file_upload_v1' as const,
                workingDirectory: targetFileRoot,
                path: 'payload.bin',
                sizeBytes: declaredSizeBytes,
                overwrite: true,
            };

        const abortController = new AbortController();
        let readCalls = 0;
        const fileReader = {
            sizeBytes: payload.byteLength,
            readBytes: async (offset: number, length: number) => {
                readCalls += 1;
                if (input.cancelMidUpload === true && readCalls > 1) {
                    abortController.abort(new Error('canceled by fixture'));
                }
                return payload.subarray(offset, offset + length);
            },
            close: async () => {},
        };

        const relay = createRelayFallbackProbe();
        const result = await uploadBulkPayloadFromFileWithCarrierFallbacks<UploadResult>({
            machineId,
            serverId,
            fileReader,
            directImportRequest,
            timeoutMs: 15_000,
            signal: input.cancelMidUpload === true ? abortController.signal : null,
            relay,
        });

        const acceptorStatus = await native.getMachineAcceptorStatus(target.endpointHandle);
        const abortInvocations = machineRpcBoundary.invocations.filter(
            (invocation) => invocation.method === RPC_METHODS.DAEMON_DIRECT_TRANSFER_IMPORT_ABORT,
        );

        const bufferedDownloadDestination = createBufferedTransferDestination(payload.byteLength);
        try {
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
                scope: { kind: 'bounded_transfer', mode: 'carrier' },
                iroh: {
                    initiator: { kind: 'account_client', endpointId: expect.stringMatching(/^[0-9a-f]{64}$/u) },
                    target: { machineId, endpointId: target.endpointId },
                    operationKind: 'finite_transfer',
                },
            });
            // Zero disallowed fallback after machine Iroh selection.
            expect(relay.init).not.toHaveBeenCalled();
            expect(relay.sendChunk).not.toHaveBeenCalled();
            expect(relay.finalize).not.toHaveBeenCalled();

            if (input.invalidateGrant) {
                expect(result).toMatchObject({ success: false, errorCode: 'machine_carrier_transport_failed' });
                expect(verifiedHandshakes).toHaveLength(0);
                expect(acceptorStatus?.streamsAccepted).toBe(0);
                expect(acceptorStatus?.streamsRejected).toBe(1);
                return;
            }

            const prepareInvocation = machineRpcBoundary.invocations.find(
                (invocation) => invocation.method === RPC_METHODS.DAEMON_DIRECT_TRANSFER_IMPORT_PREPARE,
            );
            expect(prepareInvocation).toBeDefined();
            const preparedImport = prepareInvocation?.response as {
                uploadId?: unknown;
                expectedSizeBytes?: unknown;
            } | undefined;
            const preparedUploadId = preparedImport?.uploadId;
            expect(typeof preparedUploadId).toBe('string');
            // The carrier grant only admits a finite transfer. Prepared-transfer identity and
            // byte commitment remain owned by the existing import lifecycle below the carrier.
            expect(grantRequests[0]).toMatchObject({
                scope: { kind: 'bounded_transfer', mode: 'carrier' },
            });
            expect((grantRequests[0] as { scope?: Record<string, unknown> }).scope).not.toHaveProperty('transferId');
            expect(preparedImport?.expectedSizeBytes).toBe(declaredSizeBytes);
            expect(verifiedHandshakes.length).toBeGreaterThan(0);
            expect(verifiedHandshakes).toEqual(verifiedHandshakes.map((handshake) => expect.objectContaining({
                accountId,
                flow: 'finite_transfer',
            })));
            expect(acceptorStatus?.lastPath?.observedPath).toBe(input.topology);

            if (input.declareShortSize === true || input.cancelMidUpload === true) {
                // Size rejection / mid-upload cancellation: the production target refused the
                // bytes (or the caller canceled), the production abort RPC root owned the
                // cleanup, and no standard-relay path started after the machine Iroh selection.
                expect(result).toMatchObject(input.declareShortSize === true
                    ? { success: false, errorCode: 'machine_carrier_transport_failed' }
                    : { success: false });
                expect(abortInvocations).toHaveLength(1);
                expect(abortInvocations[0]?.payload).toEqual({ uploadId: preparedUploadId });
                expect(abortInvocations[0]?.response).toMatchObject({ success: true, aborted: true });
                const unfinalizedDestination = input.transferKind === 'file'
                    ? join(targetFileRoot, 'payload.bin')
                    : join(targetAttachmentRoot, '.happier', 'uploads', 'messages', 'message-1');
                await expect(stat(unfinalizedDestination)).rejects.toMatchObject({ code: 'ENOENT' });
                return;
            }

            // Finalize receipt exactness from the production target lifecycle.
            expect(result).toMatchObject({
                success: true,
                sizeBytes: payload.byteLength,
                sha256: expectedSha256(payload),
            });
            if (result.success !== true) throw new Error('upload result unexpectedly unsuccessful');
            expect(result.path).toEqual(input.transferKind === 'file'
                ? 'payload.bin'
                : expect.stringMatching(/^\.happier\/uploads\/messages\/message-1\/[0-9a-f]{8}-composed-attachment\.bin$/u));

            // Exact recovered bytes at the production destination.
            const destinationPath = input.transferKind === 'file'
                ? join(targetFileRoot, 'payload.bin')
                : resolve(targetAttachmentRoot, result.path);
            await expect(readFile(destinationPath)).resolves.toEqual(payload);

            // Production download/read-back through the same carrier and export owner.
            const download = await downloadBulkPayloadViaDirectExportToDestination({
                machineId,
                serverId,
                request: {
                    t: 'workspace_file_download_v1',
                    workingDirectory: input.transferKind === 'file' ? targetFileRoot : targetAttachmentRoot,
                    path: input.transferKind === 'file' ? 'payload.bin' : result.path,
                    asZip: false,
                },
                destination: bufferedDownloadDestination.destination,
                timeoutMs: 15_000,
                acquirePreparedCarrier: async ({ operationId: downloadOperationId, maxBytes }) => {
                    const machineRoute = await resolveMachineCarrierRoute(machineId, serverId);
                    if (machineRoute.kind !== 'iroh_peer') return null;
                    return await machineRoute.acquire({
                        operationId: downloadOperationId,
                        maxBytes,
                        flow: input.transferKind === 'file' ? 'file_transfer' : 'attachment_transfer',
                    });
                },
            });
            expect(download).toMatchObject({
                ok: true,
                name: input.transferKind === 'file' ? 'payload.bin' : basename(result.path),
                sizeBytes: payload.byteLength,
            });
            expect(Buffer.from(bufferedDownloadDestination.toBase64(), 'base64')).toEqual(payload);
        } finally {
            machineRpcBoundary.current = null;
            await directTransferLifecycle.stop().catch(() => undefined);
            await native.stopMachineAcceptor({ endpointHandle: target.endpointHandle });
            await native.shutdownEndpoint({ endpointHandle: target.endpointHandle });
            await admissionApp.close();
            openFastifyApps.splice(openFastifyApps.indexOf(admissionApp), 1);
            await close(grantServer);
            openServers.splice(openServers.indexOf(grantServer), 1);
            await TokenStorage.removeCredentialsForServerUrl(serverUrl, { serverId });
            await rm(fixtureRoot, { recursive: true, force: true });
        }
    }

    for (const topology of ['direct', 'relay'] as const) {
        if (selectedTopology && selectedTopology !== topology) continue;
        for (const transferKind of ['file', 'attachment'] as const) {
            it(`moves exact ${transferKind} bytes through the production target over ${topology} Iroh and reads them back`, { timeout: 150_000 }, async () => {
                await runComposedTransfer({ topology, transferKind });
            });
        }
    }

    if (!selectedTopology || selectedTopology === 'direct') {
        it('rejects an invalid production-minted grant at admission without any standard fallback', { timeout: 120_000 }, async () => {
            await runComposedTransfer({ topology: 'direct', transferKind: 'file', invalidateGrant: true });
        });

        it('rejects an oversize upload at the production target and aborts the owned session without fallback', { timeout: 120_000 }, async () => {
            await runComposedTransfer({ topology: 'direct', transferKind: 'file', declareShortSize: true });
        });

        it('cancels a mid-upload transfer, aborts the owned target session, and never falls back', { timeout: 120_000 }, async () => {
            await runComposedTransfer({ topology: 'direct', transferKind: 'file', cancelMidUpload: true });
        });
    }
});

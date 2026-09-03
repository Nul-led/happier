import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    IrohMachineHandshakeV1Schema,
} from '@happier-dev/protocol';

import {
    MACHINE_CARRIER_INTERRUPTED_TRANSFER_ERROR,
} from './machineCarrierHttpLease';
import {
    MACHINE_CARRIER_STREAM_PREAMBLE_BYTE,
    type MachineCarrierBrowserStreamLease,
    type MachineCarrierStreamDuplex,
    type OpenMachineCarrierStream,
    acquireBrowserMachineCarrierStreamLease,
} from './machineCarrierBrowserStream';

const boundaries = vi.hoisted(() => {
    const focus = { activeServerId: 'server-1' };
    const serverUrls: Record<string, string> = {
        'server-1': 'https://server.example.test',
    };
    const endpointsByServerId: Record<string, {
        endpointId: string;
        directAddresses: string[];
        relayUrls: string[];
    }> = {};
    const resetEndpoints = () => {
        endpointsByServerId['server-1'] = {
            endpointId: 'a'.repeat(64),
            directAddresses: ['127.0.0.1:48123'],
            relayUrls: ['https://relay.example.test'],
        };
    };
    resetEndpoints();
    return {
        getCredentials: vi.fn(),
        requestGrant: vi.fn(),
        captureAuthority: vi.fn(),
        releaseAuthority: vi.fn(),
        resolveTargetServer: vi.fn((requestedServerId?: string | null) => {
            const requested = typeof requestedServerId === 'string' && requestedServerId.trim().length > 0
                ? requestedServerId.trim()
                : focus.activeServerId;
            const serverUrl = serverUrls[requested];
            return serverUrl ? { serverId: requested, serverUrl } : null;
        }),
        focusActiveServer: (serverId: string) => {
            focus.activeServerId = serverId;
        },
        resetEndpoints,
        replaceEndpoint: (serverId: string, endpoint: typeof endpointsByServerId[string]) => {
            endpointsByServerId[serverId] = endpoint;
        },
        readEndpoint: (serverId: string) => endpointsByServerId[serverId],
    };
});

const targetToken = 'header.eyJzdWIiOiJhY2NvdW50LWIifQ.signature';
const BROWSER_ENDPOINT_ID = 'b'.repeat(64);
const TARGET_ENDPOINT_ID = 'a'.repeat(64);

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: { getCredentialsForServerUrl: (...args: unknown[]) => boundaries.getCredentials(...args) },
}));
vi.mock('@/sync/domains/machines/peer/mediation/stream/productionRouteHttp', () => ({
    resolveTargetServer: (requestedServerId?: string | null) => boundaries.resolveTargetServer(requestedServerId),
    requestPeerRouteGrantV2: (...args: unknown[]) => boundaries.requestGrant(...args),
}));
vi.mock('@/sync/api/capabilities/getReadyServerFeatures', () => ({
    getReadyServerFeatures: async () => ({ features: {} }),
}));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/createSessionRequestWithServerScope', () => ({
    captureSessionRequestAuthorityForServerAccountScope: (...args: unknown[]) => boundaries.captureAuthority(...args),
}));
vi.mock('@/sync/domains/state/storage', () => ({
    storage: {
        getState: () => ({
            machineListByServerId: {
                'server-1': [
                    {
                        id: 'machine-1',
                        daemonState: {
                            peerMediation: {
                                iroh: {
                                    endpoint: boundaries.readEndpoint('server-1'),
                                },
                            },
                        },
                    },
                ],
            },
            machines: {},
        }),
    },
}));
vi.mock('@/sync/runtime/nativeIrohTunnels/machineHttpLifecycle', () => ({
    getIrohApplicationEndpoint: async () => ({ endpointId: 'e'.repeat(64) }),
    isIrohMachineHttpLifecycleAvailable: () => true,
    probeIrohMachineHttpLifecycleAvailability: async () => true,
    startIrohMachineHttpTunnel: vi.fn(),
}));

function grantedResponse(request: Readonly<{
    ephemeralPublicKeyBase64Url: string;
    machineId: string;
    scope: unknown;
    iroh: unknown;
    endpointFingerprint: string;
}>) {
    return {
        ok: true as const,
        value: {
            payload: {
                v: 2,
                grantId: 'grant-v2-browser',
                accountId: 'account-from-signed-grant',
                machineId: request.machineId,
                flowKind: 'bounded_transfer',
                routeKind: 'iroh_peer',
                scope: request.scope,
                iat: 1_000,
                exp: 301_000,
                aud: 'happier-daemon-route-grant',
                endpointFingerprint: request.endpointFingerprint,
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
    };
}

type FakeStreamOptions = Readonly<{
    remoteEndpointId?: string;
    decisionBytes?: readonly number[];
    /** The decision read never settles, until the stream is cancelled. */
    hangDecision?: boolean;
    inboundChunks?: readonly Uint8Array[];
    closeError?: Error;
    /** `closeError` rejects only the first close attempt, then closes succeed. */
    closeErrorOnce?: boolean;
}>;

function createFakeMachineStream(options: FakeStreamOptions = {}) {
    const events: string[] = [];
    const writes: Uint8Array[] = [];
    const openedWith: Array<Readonly<{ alpn: string; endpointId: string; relayUrls: readonly string[] }>> = [];
    const decisionQueue = [...(options.decisionBytes ?? [0x01])];
    const inboundQueue = [...(options.inboundChunks ?? [])];
    let cancelCount = 0;
    let closeCount = 0;
    let settleDecision: (() => void) | null = null;
    const decisionSettled = new Promise<void>((resolve) => {
        settleDecision = resolve;
    });

    const stream: MachineCarrierStreamDuplex = {
        remoteEndpointId: options.remoteEndpointId ?? TARGET_ENDPOINT_ID,
        observedPath: 'relay',
        read: async (maxBytes) => {
            void maxBytes;
            if (decisionQueue.length > 0) {
                events.push('decisionRead');
                const byte = decisionQueue.shift()!;
                if (options.hangDecision) {
                    await decisionSettled;
                    return { bytes: new Uint8Array(0), done: true };
                }
                return { bytes: new Uint8Array([byte]), done: false };
            }
            events.push('payloadRead');
            const chunk = inboundQueue.shift();
            if (chunk === undefined) return { bytes: new Uint8Array(0), done: true };
            return { bytes: chunk, done: false };
        },
        write: async (bytes) => {
            events.push('write');
            writes.push(bytes);
        },
        finishWrite: async () => {
            events.push('finish');
        },
        cancel: () => {
            cancelCount += 1;
            events.push('cancel');
            settleDecision?.();
        },
        close: async () => {
            closeCount += 1;
            events.push('close');
            if (options.closeError && (closeCount === 1 || !options.closeErrorOnce)) {
                throw options.closeError;
            }
        },
    };

    const open: OpenMachineCarrierStream = async (input) => {
        events.push('open');
        openedWith.push(input);
        return stream;
    };

    return {
        open,
        events,
        writes,
        openedWith,
        cancelCount: () => cancelCount,
        closeCount: () => closeCount,
    };
}

function createEndpointLeaseBoundary() {
    const release = vi.fn(async () => undefined);
    const acquireEndpointLease = vi.fn(async (_relayUrls: readonly string[]) => ({
        endpointId: BROWSER_ENDPOINT_ID,
        release,
    }));
    return { acquireEndpointLease, release };
}

type AcquireInput = Partial<Parameters<typeof acquireBrowserMachineCarrierStreamLease>[0]>;

async function acquireWith(
    overrides: AcquireInput = {},
    streamOptions: FakeStreamOptions = {},
): Promise<{
    lease: MachineCarrierBrowserStreamLease;
    machineStream: ReturnType<typeof createFakeMachineStream>;
    endpointLease: ReturnType<typeof createEndpointLeaseBoundary>;
}> {
    const endpointLease = createEndpointLeaseBoundary();
    const machineStream = createFakeMachineStream(streamOptions);
    const lease = await acquireBrowserMachineCarrierStreamLease({
        operationId: 'prepared-browser-1',
        machineId: 'machine-1',
        serverId: 'server-1',
        flow: 'file_transfer',
        maxBytes: 5,
        acquireEndpointLease: endpointLease.acquireEndpointLease,
        openMachineCarrierStream: machineStream.open,
        ...overrides,
    });
    return { lease, machineStream, endpointLease };
}

describe('acquireBrowserMachineCarrierStreamLease', () => {
    beforeEach(() => {
        boundaries.resolveTargetServer.mockClear();
        boundaries.focusActiveServer('server-1');
        boundaries.resetEndpoints();
        boundaries.getCredentials.mockReset();
        boundaries.requestGrant.mockReset();
        boundaries.captureAuthority.mockReset();
        boundaries.releaseAuthority.mockReset();
        boundaries.getCredentials.mockResolvedValue({ token: targetToken });
        boundaries.captureAuthority.mockResolvedValue({
            scope: { serverId: 'server-1', accountId: 'account-b' },
            request: vi.fn(),
            release: boundaries.releaseAuthority,
        });
        boundaries.requestGrant.mockImplementation(async ({ request }: {
            request: Parameters<typeof grantedResponse>[0];
        }) => grantedResponse(request));
    });

    it('opens happier/machine/1 to the exact signed target and writes the canonical framed handshake exactly once', async () => {
        const { lease, machineStream, endpointLease } = await acquireWith();

        // The dial targets exactly the signed machine endpoint through its own
        // descriptor relays, on the machine ALPN — never a Home-tunnel stream.
        expect(machineStream.openedWith).toEqual([
            {
                alpn: 'happier/machine/1',
                endpointId: TARGET_ENDPOINT_ID,
                relayUrls: ['https://relay.example.test'],
            },
        ]);

        // One write carries the whole canonical frame: preamble, u32be length,
        // handshake JSON — the exact frame the native carrier pump writes.
        expect(machineStream.writes).toHaveLength(1);
        const frame = machineStream.writes[0]!;
        expect(frame[0]).toBe(MACHINE_CARRIER_STREAM_PREAMBLE_BYTE);
        const length = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(1, false);
        expect(length).toBe(frame.byteLength - 5);
        const handshake = JSON.parse(new TextDecoder().decode(frame.subarray(5)));
        expect(IrohMachineHandshakeV1Schema.safeParse(handshake).success).toBe(true);
        expect(handshake.initiator).toEqual({ kind: 'account_client', endpointId: BROWSER_ENDPOINT_ID });
        expect(handshake.target).toEqual({ machineId: 'machine-1', endpointId: TARGET_ENDPOINT_ID });
        expect(handshake.flow).toBe('file_transfer');
        expect(handshake.operationId).toBe('prepared-browser-1');
        expect(handshake.accountId).toBe('account-from-signed-grant');

        // The one admission decision byte is consumed before any payload write.
        expect(machineStream.events.indexOf('decisionRead'))
            .toBeGreaterThan(machineStream.events.indexOf('write'));

        // The initiator is the actual shared browser endpoint from the lease,
        // minted through the one canonical grant owner with the V2 shape.
        expect(endpointLease.acquireEndpointLease).toHaveBeenCalledWith(['https://relay.example.test']);
        const grantCall = boundaries.requestGrant.mock.calls[0]?.[0] as {
            request: { routeKind: string; scope: Record<string, unknown>; iroh: { initiator: unknown; target: unknown } };
        };
        expect(grantCall.request.routeKind).toBe('iroh_peer');
        expect(grantCall.request.scope).toMatchObject({
            kind: 'bounded_transfer',
            mode: 'single',
            transferId: 'prepared-browser-1',
            maxBytes: 5,
        });
        expect(grantCall.request.iroh.initiator).toEqual({ kind: 'account_client', endpointId: BROWSER_ENDPOINT_ID });
        expect(grantCall.request.iroh.target).toEqual({ machineId: 'machine-1', endpointId: TARGET_ENDPOINT_ID });

        expect(lease.kind).toBe('browser_stream');
        expect(lease.remoteEndpointId).toBe(TARGET_ENDPOINT_ID);
        expect(lease.observedPath).toBe('relay');
        expect(lease.handshakeJson).toBe(JSON.stringify(handshake));
    });

    it('fails closed before any byte when the stream proves a different remote EndpointId', async () => {
        const mismatched = createFakeMachineStream({ remoteEndpointId: 'd'.repeat(64) });
        const endpointLease = createEndpointLeaseBoundary();

        await expect(acquireBrowserMachineCarrierStreamLease({
            operationId: 'prepared-browser-mismatch',
            machineId: 'machine-1',
            serverId: 'server-1',
            flow: 'file_transfer',
            maxBytes: 5,
            acquireEndpointLease: endpointLease.acquireEndpointLease,
            openMachineCarrierStream: mismatched.open,
        })).rejects.toMatchObject({ errorCode: 'machine_carrier_transport_failed' });

        // Not one byte — including the handshake — reached the wrong peer, and
        // the custody taken for the acquisition was fully released.
        expect(mismatched.writes).toHaveLength(0);
        expect(mismatched.cancelCount()).toBe(1);
        expect(endpointLease.release).toHaveBeenCalledTimes(1);
    });

    it('maps an admission rejection to the existing machine-carrier failure and never a standard path', async () => {
        const rejected = createFakeMachineStream({ decisionBytes: [0x00] });
        const endpointLease = createEndpointLeaseBoundary();

        await expect(acquireBrowserMachineCarrierStreamLease({
            operationId: 'prepared-browser-reject',
            machineId: 'machine-1',
            serverId: 'server-1',
            flow: 'file_transfer',
            maxBytes: 5,
            acquireEndpointLease: endpointLease.acquireEndpointLease,
            openMachineCarrierStream: rejected.open,
        })).rejects.toMatchObject({
            errorCode: 'machine_carrier_transport_failed',
            message: MACHINE_CARRIER_INTERRUPTED_TRANSFER_ERROR,
        });

        expect(rejected.closeCount()).toBe(1);
        expect(endpointLease.release).toHaveBeenCalledTimes(1);
    });

    it('carries post-admission bytes bidirectionally through the one admitted duplex', async () => {
        const payload = new Uint8Array([1, 2, 3, 4, 5]);
        const responseChunk = new Uint8Array([9, 8, 7]);
        const { lease, machineStream } = await acquireWith({
            operationId: 'prepared-browser-bytes',
            maxBytes: payload.byteLength,
        }, { inboundChunks: [responseChunk] });

        await lease.duplex.write(payload);
        expect(machineStream.writes[1]).toEqual(payload);

        const read = await lease.duplex.read(64);
        expect(read.bytes).toEqual(responseChunk);
        expect(read.done).toBe(false);

        await lease.duplex.finishWrite();
        expect(machineStream.events).toContain('finish');
    });

    it('cancels the stream and releases custody when the caller aborts during admission', async () => {
        const hanging = createFakeMachineStream({ hangDecision: true });
        const endpointLease = createEndpointLeaseBoundary();
        const controller = new AbortController();

        const promise = acquireBrowserMachineCarrierStreamLease({
            operationId: 'prepared-browser-abort',
            machineId: 'machine-1',
            serverId: 'server-1',
            flow: 'file_transfer',
            maxBytes: 5,
            signal: controller.signal,
            acquireEndpointLease: endpointLease.acquireEndpointLease,
            openMachineCarrierStream: hanging.open,
        });
        // The handshake frame is written, then the caller aborts while the
        // decision byte is outstanding.
        await vi.waitFor(() => expect(hanging.writes).toHaveLength(1));
        controller.abort();

        await expect(promise).rejects.toMatchObject({ errorCode: 'machine_carrier_transport_failed' });
        expect(hanging.cancelCount()).toBe(1);
        expect(endpointLease.release).toHaveBeenCalledTimes(1);
    });

    it('releases the stream and the endpoint lease exactly once across concurrent release calls', async () => {
        const { lease, machineStream, endpointLease } = await acquireWith();

        await Promise.all([lease.release(), lease.release()]);
        await lease.release();

        expect(machineStream.closeCount()).toBe(1);
        expect(endpointLease.release).toHaveBeenCalledTimes(1);
    });

    it('retains custody after a failed release and retries it on the next release call', async () => {
        const failingClose = createFakeMachineStream({
            closeError: new Error('close rejected'),
            closeErrorOnce: true,
        });
        const endpointLease = createEndpointLeaseBoundary();
        const lease = await acquireBrowserMachineCarrierStreamLease({
            operationId: 'prepared-browser-release-retry',
            machineId: 'machine-1',
            serverId: 'server-1',
            flow: 'file_transfer',
            maxBytes: 5,
            acquireEndpointLease: endpointLease.acquireEndpointLease,
            openMachineCarrierStream: failingClose.open,
        });

        await expect(lease.release()).rejects.toThrow('close rejected');
        expect(endpointLease.release).toHaveBeenCalledTimes(1);

        // Custody is retained: the retry runs the whole release again instead
        // of reporting a success that never happened.
        await lease.release();
        expect(failingClose.closeCount()).toBe(2);
        expect(endpointLease.release).toHaveBeenCalledTimes(2);
    });

    it('rejects a failed endpoint lease release instead of swallowing it, then retries the whole release', async () => {
        // The endpoint lease release is the worker's forced close for the
        // stream, so a failure there is custody the worker still holds: the
        // release must observe it, not resolve as if nothing happened.
        const endpointLease = createEndpointLeaseBoundary();
        const machineStream = createFakeMachineStream();
        let releaseFailures = 1;
        endpointLease.release.mockImplementation(async () => {
            if (releaseFailures > 0) {
                releaseFailures -= 1;
                throw new Error('endpoint lease release failed');
            }
        });
        const lease = await acquireBrowserMachineCarrierStreamLease({
            operationId: 'prepared-browser-lease-retry',
            machineId: 'machine-1',
            serverId: 'server-1',
            flow: 'file_transfer',
            maxBytes: 5,
            acquireEndpointLease: endpointLease.acquireEndpointLease,
            openMachineCarrierStream: machineStream.open,
        });

        await expect(lease.release()).rejects.toThrow('endpoint lease release failed');
        expect(machineStream.closeCount()).toBe(1);
        expect(endpointLease.release).toHaveBeenCalledTimes(1);

        // Custody is retained: the next explicit release runs the whole close
        // and release again and succeeds.
        await lease.release();
        expect(machineStream.closeCount()).toBe(2);
        expect(endpointLease.release).toHaveBeenCalledTimes(2);
    });

    it('coalesces concurrent releases into one attempt whose failure every caller observes', async () => {
        const endpointLease = createEndpointLeaseBoundary();
        const machineStream = createFakeMachineStream();
        let rejectFirstAttempt!: (error: unknown) => void;
        const firstAttempt = new Promise<void>((_resolve, reject) => {
            rejectFirstAttempt = reject;
        });
        let attempts = 0;
        endpointLease.release.mockImplementation(async () => {
            attempts += 1;
            if (attempts === 1) await firstAttempt;
        });
        const lease = await acquireBrowserMachineCarrierStreamLease({
            operationId: 'prepared-browser-coalesce',
            machineId: 'machine-1',
            serverId: 'server-1',
            flow: 'file_transfer',
            maxBytes: 5,
            acquireEndpointLease: endpointLease.acquireEndpointLease,
            openMachineCarrierStream: machineStream.open,
        });

        const first = lease.release();
        const second = lease.release();
        // Both callers join the one in-flight attempt: exactly one endpoint
        // lease release runs while it is outstanding.
        await vi.waitFor(() => expect(endpointLease.release).toHaveBeenCalledTimes(1));

        rejectFirstAttempt(new Error('endpoint lease release failed'));
        await expect(first).rejects.toThrow('endpoint lease release failed');
        await expect(second).rejects.toThrow('endpoint lease release failed');

        // The next explicit release retries the whole release and succeeds.
        await lease.release();
        expect(machineStream.closeCount()).toBe(2);
        expect(endpointLease.release).toHaveBeenCalledTimes(2);
    });

    it('surfaces a failed custody release when the acquisition itself fails', async () => {
        // The dial failure already fails the acquisition, but the failed lease
        // release during cleanup must not be swallowed behind it: the worker
        // still holds the lease, and the rejection has to say so.
        const endpointLease = createEndpointLeaseBoundary();
        endpointLease.release.mockRejectedValue(new Error('endpoint lease release failed'));
        const refusedOpen: OpenMachineCarrierStream = async () => {
            throw new Error('dial refused');
        };

        const acquisition = acquireBrowserMachineCarrierStreamLease({
            operationId: 'prepared-browser-custody',
            machineId: 'machine-1',
            serverId: 'server-1',
            flow: 'file_transfer',
            maxBytes: 5,
            acquireEndpointLease: endpointLease.acquireEndpointLease,
            openMachineCarrierStream: refusedOpen,
        });

        await expect(acquisition).rejects.toThrow(/endpoint lease release failed/u);
        expect(endpointLease.release).toHaveBeenCalledTimes(1);
    });

    it('fails like the native lease owner when no signed target exists and never opens a stream', async () => {
        // An unparseable endpoint descriptor is not a target the grant owner
        // could bind, exactly as for the native lease owner.
        boundaries.replaceEndpoint('server-1', {
            endpointId: '',
            directAddresses: [],
            relayUrls: [],
        });
        const missing = createFakeMachineStream();
        const endpointLease = createEndpointLeaseBoundary();

        await expect(acquireBrowserMachineCarrierStreamLease({
            operationId: 'prepared-browser-missing-target',
            machineId: 'machine-1',
            serverId: 'server-1',
            flow: 'file_transfer',
            maxBytes: 5,
            acquireEndpointLease: endpointLease.acquireEndpointLease,
            openMachineCarrierStream: missing.open,
        })).rejects.toThrow('A direct machine connection is required for this transfer.');

        expect(missing.openedWith).toHaveLength(0);
        expect(endpointLease.acquireEndpointLease).not.toHaveBeenCalled();
    });
});

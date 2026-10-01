import { afterEach, describe, expect, it, vi } from 'vitest';

import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';
import { RPC_ERROR_CODES, RPC_METHODS } from '@happier-dev/protocol/rpc';
import {
    UiBrowserRecordingCaptureFrameResponseV1Schema,
    uiBrowserAutomationDispatchMethod,
    type UiBrowserRecordingCaptureFrameRequestV1,
} from '@happier-dev/protocol';
import type { Encryption } from '@/sync/encryption/encryption';
import { createSocketIoBoundaryStub } from '@/dev/testkit/mocks/socketIo';
import { createBrowserAutomationControlService } from '@/sync/domains/browser/automation/controlService';
import { registerBrowserRuntimeControlAdapter } from '@/sync/domains/browser/actions/runtimeControlRegistry';
import { applyBrowserControlEvent, createBrowserControlState } from '@/sync/domains/browser/control';
import { buildBrowserAdapterCapabilities } from '@/sync/domains/browser/adapters/capabilities';
import { apiSocket } from './apiSocket';

type SocketEventHandler = (...args: unknown[]) => void;
type SocketStub = ReturnType<typeof createSocketIoBoundaryStub>['socket'];

const rpcBoundary = vi.hoisted(() => ({
    socket: null as SocketStub | null,
    requirePlainCompatibility: async () => {},
}));

vi.mock('socket.io-client', () => ({ io: () => rpcBoundary.socket }));
vi.mock('@/sync/api/capabilities/accountStoredContentCompatibility', () => ({
    requireCurrentAccountStoredContentServerCompatibility: () => rpcBoundary.requirePlainCompatibility(),
}));
vi.mock('@/sync/runtime/connectivity/serverReachabilitySupervisorPool', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool')>();
    return {
        ...actual,
        subscribeServerReachabilityState: (_serverUrl: string, listener: (state: import('@happier-dev/connection-supervisor').ManagedConnectionState) => void) => {
            listener({
                phase: 'online', reason: 'initial_connect', attempt: 0, nextRetryAt: null,
                lastConnectedAt: Date.now(), lastDisconnectedAt: null, lastErrorMessage: null,
            });
            return () => {};
        },
        startServerReachabilitySupervisor: vi.fn(async () => {}),
    };
});

/**
 * Reversible test "encryption": prefixes a JSON encoding so encrypt/decrypt round-trip is symmetric
 * exactly like the daemon<->UI machine envelope (daemon encrypt -> UI decryptRaw, UI encryptRaw ->
 * daemon decrypt). Lets the test drive the real apiSocket dispatch path without real crypto.
 */
function createFakeMachineEncryption() {
    return {
        encryptRaw: vi.fn(async (data: unknown): Promise<string> => `enc:${JSON.stringify(data ?? null)}`),
        decryptRaw: vi.fn(async (encrypted: string): Promise<unknown> => {
            if (typeof encrypted !== 'string' || !encrypted.startsWith('enc:')) return null;
            try {
                return JSON.parse(encrypted.slice('enc:'.length));
            } catch {
                return null;
            }
        }),
    };
}

function machineEncryptParams(data: unknown): string {
    return `enc:${JSON.stringify(data ?? null)}`;
}

function machineDecryptAck(ack: unknown): unknown {
    if (typeof ack !== 'string' || !ack.startsWith('enc:')) {
        throw new Error(`Expected machine-encrypted ack, received: ${String(ack)}`);
    }
    return JSON.parse(ack.slice('enc:'.length));
}

function createSocketStub() { return createSocketIoBoundaryStub(); }

function getRegisteredHandler(socket: SocketStub, event: string): SocketEventHandler | undefined {
    const call = socket.on.mock.calls.find(([registeredEvent]) => registeredEvent === event);
    return call?.[1];
}

function emittedMethods(socket: SocketStub, event: string): string[] {
    return socket.emit.mock.calls
        .filter(([emittedEvent]) => emittedEvent === event)
        .map(([, payload]) => payload && typeof payload === 'object' && 'method' in payload && typeof payload.method === 'string' ? payload.method : '');
}

async function bootApiSocket(params: Readonly<{
    socket: SocketStub;
    getMachineEncryption: (machineId: string) => unknown;
    requirePlainCompatibility?: () => Promise<void>;
}>) {
    rpcBoundary.socket = params.socket;
    rpcBoundary.requirePlainCompatibility = params.requirePlainCompatibility ?? (async () => {});
    apiSocket.initialize(
        { endpoint: 'https://api.example.test', token: 'token-a' },
        {
            getSessionEncryption: () => null,
            getMachineEncryption: params.getMachineEncryption,
        } as unknown as Encryption,
    );

    await vi.waitFor(() => {
        expect(getRegisteredHandler(params.socket, SOCKET_RPC_EVENTS.REQUEST)).toBeTypeOf('function');
    });

    return apiSocket;
}

afterEach(() => {
    apiSocket.disconnect();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('apiSocket inbound machine-scoped reverse RPC (RU2 G1)', () => {
    it('dispatches encrypted automation to the existing mounted owner and retires its exact handler', async () => {
        const { socket } = createSocketStub();
        const apiSocket = await bootApiSocket({ socket, getMachineEncryption: () => createFakeMachineEncryption() });
        const view = { browserSessionId: 'socket-session', viewId: 'socket-view' };
        const service = createBrowserAutomationControlService({ nowMs: Date.now });
        service.registerOwner({ ...view, ownerId: 'socket-engine', authority: 'uiLocal', navigationGeneration: 0,
            adapterKind: 'localPreview', fidelity: 'injectedPage', trustedInput: false, supportedActions: ['click'],
            executeAction: async () => ({ status: 'succeeded', resultSummary: { clicked: true, cookie: 'private-cookie' } }),
        });
        const state = applyBrowserControlEvent(applyBrowserControlEvent(createBrowserControlState(), {
            kind: 'sessionCreated', browserSessionId: view.browserSessionId, eventId: 'session', profileId: 'profile', occurredAt: 1,
        }), {
            kind: 'viewOpened', ...view, eventId: 'view', occurredAt: 2, platform: 'web', adapterKind: 'localPreview', engineKind: 'webIframe',
            target: { kind: 'externalUrl', targetId: 'page', url: 'https://example.test', display: { title: 'Page', addressLabel: 'example.test' } },
            adapterCapabilities: buildBrowserAdapterCapabilities({ adapterKind: 'localPreview', supportedTargetKinds: ['externalUrl'], supportedRenderEngines: ['webIframe'] }),
        });
        const disposeOwner = registerBrowserRuntimeControlAdapter({ browserSessionId: view.browserSessionId,
            control: { readState: () => state, applyDispatchResult: () => {} }, automation: { controlService: service } });
        const disposeHandler = apiSocket.installBrowserAutomationReverseDispatch('machine-1', view);
        const method = `machine-1:${uiBrowserAutomationDispatchMethod(view)}`;
        const requestHandler = getRegisteredHandler(socket, SOCKET_RPC_EVENTS.REQUEST)!;
        const call = () => new Promise<unknown>((resolve) => requestHandler({ method, params: machineEncryptParams({
            v: 1, actionId: 'browser.automation.click', authority: 'account_automation', input: {
                v: 1, ...view, automationRequestId: 'socket-click', actionKind: 'click', navigationGeneration: 0,
                requestedBy: 'agent', requesterRef: { kind: 'agent', id: 'agent' }, timeoutMs: 1000, payload: { selector: '#go' },
            },
        }) }, resolve));
        try {
            const ack = machineDecryptAck(await call());
            expect(ack).toMatchObject({ status: 'succeeded', trustedInput: false, resultSummary: { clicked: true } });
            expect(JSON.stringify(ack)).not.toContain('private-cookie');
            disposeHandler();
            expect(emittedMethods(socket, SOCKET_RPC_EVENTS.UNREGISTER)).toContain(method);
            expect(machineDecryptAck(await call())).toMatchObject({ errorCode: RPC_ERROR_CODES.METHOD_NOT_FOUND });
        } finally {
            disposeHandler();
            disposeOwner();
        }
    });

    it('round-trips forward and reverse machine RPC in plaintext mode without a machine key', async () => {
        const { socket } = createSocketStub();
        socket.emitWithAck.mockImplementation(async (event: string, payload: unknown) => {
            expect(event).toBe(SOCKET_RPC_EVENTS.CALL);
            expect(payload).toMatchObject({
                method: 'machine-plain:demo.forward',
                params: { hello: 'daemon' },
            });
            return { ok: true, result: { hello: 'ui' } };
        });
        const apiSocket = await bootApiSocket({
            socket,
            getMachineEncryption: () => null,
        });
        const { storage } = await import('@/sync/domains/state/storage');
        storage.getState().applyMachines([{
            id: 'machine-plain',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            revokedAt: null,
            metadata: null,
            metadataVersion: 0,
            daemonState: null,
            daemonStateVersion: 0,
            storageMode: 'plain',
        }], true);

        await expect(apiSocket.machineRPC(
            'machine-plain',
            'demo.forward',
            { hello: 'daemon' },
        )).resolves.toEqual({ hello: 'ui' });

        const handler = vi.fn(async (params: unknown) => ({ echoed: params }));
        apiSocket.registerMachineScopedRpcHandler('machine-plain', 'demo.reverse', handler);
        const requestHandler = getRegisteredHandler(socket, SOCKET_RPC_EVENTS.REQUEST)!;
        const ack = await new Promise<unknown>((resolve) => {
            void requestHandler(
                {
                    method: 'machine-plain:demo.reverse',
                    params: { hello: 'world' },
                },
                resolve,
            );
        });

        expect(handler).toHaveBeenCalledWith({ hello: 'world' });
        expect(ack).toEqual({ echoed: { hello: 'world' } });
        storage.getState().applyMachines([], true);
    });

    it('refuses plaintext Machine RPC before socket emission when the server compatibility is not active', async () => {
        const { socket } = createSocketStub();
        const upgradeRequired = Object.assign(new Error('upgrade required'), {
            code: 'client-upgrade-required',
            retryable: false as const,
        });
        const apiSocket = await bootApiSocket({
            socket,
            getMachineEncryption: () => null,
            requirePlainCompatibility: vi.fn(async () => {
                throw upgradeRequired;
            }),
        });
        const { storage } = await import('@/sync/domains/state/storage');
        storage.getState().applyMachines([{
            id: 'machine-plain-old-server',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            revokedAt: null,
            metadata: null,
            metadataVersion: 0,
            daemonState: null,
            daemonStateVersion: 0,
            storageMode: 'plain',
        }], true);

        await expect(apiSocket.machineRPC(
            'machine-plain-old-server',
            'demo.forward',
            { hello: 'daemon' },
        )).rejects.toBe(upgradeRequired);
        expect(socket.emitWithAck).not.toHaveBeenCalled();
        storage.getState().applyMachines([], true);
    });

    it('registers a machine-scoped handler and round-trips request -> handler -> encrypted ack', async () => {
        const { socket } = createSocketStub();
        const machineEnc = createFakeMachineEncryption();
        const apiSocket = await bootApiSocket({
            socket,
            getMachineEncryption: (id) => (id === 'machine-1' ? machineEnc : null),
        });

        const handler = vi.fn(async (params: unknown) => ({ echoed: params }));
        apiSocket.registerMachineScopedRpcHandler('machine-1', 'ui.demo.method', handler);

        // The socket joined the per-machine rpc room.
        expect(emittedMethods(socket, SOCKET_RPC_EVENTS.REGISTER)).toContain('machine-1:ui.demo.method');

        const requestHandler = getRegisteredHandler(socket, SOCKET_RPC_EVENTS.REQUEST)!;
        const ack = await new Promise<unknown>((resolve) => {
            void requestHandler(
                { method: 'machine-1:ui.demo.method', params: machineEncryptParams({ hello: 'world' }) },
                resolve,
            );
        });

        // Params were decrypted with the machine key before reaching the handler.
        expect(handler).toHaveBeenCalledWith({ hello: 'world' });
        // The ack was re-encrypted with the machine key and carries the handler result.
        expect(machineDecryptAck(ack)).toEqual({ echoed: { hello: 'world' } });
    });

    it('fails closed for an unknown method and for a machine with no encryption', async () => {
        const { socket } = createSocketStub();
        const machineEnc = createFakeMachineEncryption();
        await bootApiSocket({
            socket,
            getMachineEncryption: (id) => (id === 'machine-1' ? machineEnc : null),
        });
        const requestHandler = getRegisteredHandler(socket, SOCKET_RPC_EVENTS.REQUEST)!;

        // Unknown method on a decryptable machine -> encrypted METHOD_NOT_FOUND (daemon treats as no UI).
        const unknownAck = await new Promise<unknown>((resolve) => {
            void requestHandler(
                { method: 'machine-1:ui.unregistered', params: machineEncryptParams({}) },
                resolve,
            );
        });
        expect(machineDecryptAck(unknownAck)).toMatchObject({ errorCode: RPC_ERROR_CODES.METHOD_NOT_FOUND });

        // No machine encryption -> fail closed without ever decrypting/encrypting (isolate this path).
        machineEnc.encryptRaw.mockClear();
        machineEnc.decryptRaw.mockClear();
        const noKeyAck = await new Promise<unknown>((resolve) => {
            void requestHandler(
                { method: 'machine-unknown:ui.demo.method', params: machineEncryptParams({}) },
                resolve,
            );
        });
        expect(noKeyAck).toMatchObject({ errorCode: RPC_ERROR_CODES.METHOD_NOT_FOUND });
        expect(machineEnc.encryptRaw).not.toHaveBeenCalled();
    });

    it('re-registers inbound rooms on reconnect and stops routing after dispose', async () => {
        const { socket } = createSocketStub();
        const machineEnc = createFakeMachineEncryption();
        const apiSocket = await bootApiSocket({
            socket,
            getMachineEncryption: (id) => (id === 'machine-1' ? machineEnc : null),
        });

        const dispose = apiSocket.registerMachineScopedRpcHandler('machine-1', 'ui.demo.method', async () => ({ ok: true }));
        socket.emit.mockClear();

        // Simulate a reconnect: every installed inbound room is re-joined.
        socket.connect();
        expect(emittedMethods(socket, SOCKET_RPC_EVENTS.REGISTER)).toContain('machine-1:ui.demo.method');

        // Dispose leaves the room and stops answering.
        dispose();
        expect(emittedMethods(socket, SOCKET_RPC_EVENTS.UNREGISTER)).toContain('machine-1:ui.demo.method');

        const requestHandler = getRegisteredHandler(socket, SOCKET_RPC_EVENTS.REQUEST)!;
        const ack = await new Promise<unknown>((resolve) => {
            void requestHandler(
                { method: 'machine-1:ui.demo.method', params: machineEncryptParams({}) },
                resolve,
            );
        });
        // Method is no longer handled -> fail closed.
        expect(machineDecryptAck(ack)).toMatchObject({ errorCode: RPC_ERROR_CODES.METHOD_NOT_FOUND });
    });

    it('installBrowserRecordingReverseCapture routes to the reverse-capture handler and returns a contract-valid ack', async () => {
        const { socket } = createSocketStub();
        const machineEnc = createFakeMachineEncryption();
        const apiSocket = await bootApiSocket({
            socket,
            getMachineEncryption: (id) => (id === 'machine-1' ? machineEnc : null),
        });

        apiSocket.installBrowserRecordingReverseCapture('machine-1');
        const prefixed = `machine-1:${RPC_METHODS.UI_BROWSER_RECORDING_CAPTURE_FRAME}`;
        expect(emittedMethods(socket, SOCKET_RPC_EVENTS.REGISTER)).toContain(prefixed);

        const request: UiBrowserRecordingCaptureFrameRequestV1 = {
            protocolVersion: 1,
            browserSessionId: 'browser_session_1',
            viewId: 'view_1',
            navigationGeneration: 2,
            captureRequestId: 'capture_1',
            outputPath: '/tmp/recordings/rec.capture_1.native-view.png',
            maxBytes: 16_000_000,
        };
        const requestHandler = getRegisteredHandler(socket, SOCKET_RPC_EVENTS.REQUEST)!;
        const ack = await new Promise<unknown>((resolve) => {
            void requestHandler({ method: prefixed, params: machineEncryptParams(request) }, resolve);
        });

        // The inbound request reached the real UI reverse-capture handler and produced a
        // contract-valid, machine-encrypted reference-only response. (Outside Tauri the native
        // capture is unavailable, so the handler fails closed inside a valid response envelope.)
        const decoded = machineDecryptAck(ack);
        const parsed = UiBrowserRecordingCaptureFrameResponseV1Schema.safeParse(decoded);
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.result.ok).toBe(false);
    });
});

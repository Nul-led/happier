import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { ElectronIrohTunnelService, IROH_ENDPOINT_KEY_RELPATH } from './irohTunnel';

const ENDPOINT_ID = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const USER_DATA = join('/happier-test', 'desktop-user-data');
const CANONICAL_KEY_PATH = join(USER_DATA, ...IROH_ENDPOINT_KEY_RELPATH);

function createNativeFake() {
    const calls = {
        start: [] as unknown[],
        stop: [] as string[],
        shutdown: [] as string[],
        status: [] as string[],
    };
    const native = {
        startHomeTunnel: async (request: {
            homeServerIdentityId: string;
            endpointId: string;
            relayPolicy: string;
            endpointKeyPath?: string;
        }) => {
            calls.start.push(request);
            return {
                leaseId: 'iroh-lease-1',
                homeServerIdentityId: request.homeServerIdentityId,
                homeEndpointId: request.endpointId,
                runtimeOrigin: 'http://127.0.0.1:46011',
                carrier: 'iroh' as const,
                observedPath: 'direct' as const,
                startedAtMs: 42,
                // The keyed endpoint handle is the canonical key path; it must
                // never reach the renderer.
                endpointHandle: request.endpointKeyPath,
            };
        },
        stopHomeTunnel: async (leaseId: string) => {
            calls.stop.push(leaseId);
        },
        getTunnelStatus: async (tunnelId: string) => {
            calls.status.push(tunnelId);
            return { active: false, connectionActive: false, observedPath: 'relay' };
        },
        shutdownEndpoint: async (request: { endpointHandle: string }) => {
            calls.shutdown.push(request.endpointHandle);
        },
    };
    return { native, calls };
}

function createService(native: unknown): ElectronIrohTunnelService {
    return new ElectronIrohTunnelService({
        userDataPath: () => USER_DATA,
        loadNative: async () => (native === null ? null : (native as never)),
    });
}

test('start injects the host-owned persistent key path and returns only renderer lease facts', async () => {
    const { native, calls } = createNativeFake();
    const service = createService(native);

    const lease = await service.startHomeTunnel({
        homeServerIdentityId: 'srv_home_a',
        endpointId: ENDPOINT_ID,
        policy: 'automatic',
        relayUrls: ['https://relay.example.test'],
        directAddresses: ['192.168.1.10:4242'],
        descriptorRevision: 4,
        // Renderer-supplied identity material must never reach the native request.
        endpointKeyPath: '/tmp/renderer.key',
        endpointSeedBase64: 'AAAA',
    });

    assert.deepEqual(calls.start, [
        {
            homeServerIdentityId: 'srv_home_a',
            endpointId: ENDPOINT_ID,
            relayPolicy: 'automatic',
            relayUrls: ['https://relay.example.test'],
            directAddresses: ['192.168.1.10:4242'],
            descriptorRevision: 4,
            endpointKeyPath: CANONICAL_KEY_PATH,
        },
    ]);
    assert.deepEqual(lease, {
        leaseId: 'iroh-lease-1',
        homeServerIdentityId: 'srv_home_a',
        homeEndpointId: ENDPOINT_ID,
        runtimeOrigin: 'http://127.0.0.1:46011',
        carrier: 'iroh',
        observedPath: 'direct',
        startedAtMs: 42,
    });
});

test('status polling returns only transport facts and keeps host identity material private', async () => {
    const { native, calls } = createNativeFake();
    const service = createService(native);

    assert.deepEqual(await service.getTunnelStatus('iroh-lease-1'), {
        active: false,
        connectionActive: false,
        observedPath: 'relay',
    });
    assert.deepEqual(calls.status, ['iroh-lease-1']);
});

test('stop routes by lease and process shutdown closes the endpoint without touching identity', async () => {
    const { native, calls } = createNativeFake();
    const service = createService(native);

    await service.startHomeTunnel({ homeServerIdentityId: 'srv_home_a', endpointId: ENDPOINT_ID, policy: 'automatic' });
    await service.stopHomeTunnel('iroh-lease-1');
    assert.deepEqual(calls.stop, ['iroh-lease-1']);

    // Nothing to shut down before a start: the addon is not even loaded.
    const idleService = createService(native);
    await idleService.shutdownForProcessExit();
    assert.deepEqual(calls.shutdown, []);

    await service.shutdownForProcessExit();
    assert.deepEqual(calls.shutdown, [CANONICAL_KEY_PATH]);
    // A second shutdown is a no-op (the handle was consumed).
    await service.shutdownForProcessExit();
    assert.deepEqual(calls.shutdown, [CANONICAL_KEY_PATH]);
});

test('native unavailability and native failures reject without ever succeeding', async () => {
    const unavailable = createService(null);
    await assert.rejects(
        unavailable.startHomeTunnel({ homeServerIdentityId: 'srv_home_a', endpointId: ENDPOINT_ID, policy: 'automatic' }),
        (error: Error) => error.message.startsWith('iroh_native_error:unavailable:'),
    );
    await assert.rejects(
        unavailable.stopHomeTunnel('lease'),
        (error: Error) => error.message.startsWith('iroh_native_error:unavailable:'),
    );

    const { native } = createNativeFake();
    const failing = {
        ...native,
        startHomeTunnel: async () => {
            throw Object.assign(new Error('endpointId is invalid'), { name: 'IrohNativeOperationError', nativeCode: 'endpoint-identity-invalid' });
        },
    };
    const service = createService(failing);
    await assert.rejects(
        service.startHomeTunnel({ homeServerIdentityId: 'srv_home_a', endpointId: 'bad', policy: 'automatic' }),
        (error: Error) => error.message === 'iroh_native_error:endpoint-identity-invalid:endpointId is invalid',
    );
});

test('malformed native results fail closed instead of being adopted', async () => {
    const { native } = createNativeFake();
    const malformed = {
        ...native,
        startHomeTunnel: async () => ({ leaseId: 'iroh-lease-1' }),
    };
    const service = createService(malformed);
    await assert.rejects(
        service.startHomeTunnel({ homeServerIdentityId: 'srv_home_a', endpointId: ENDPOINT_ID, policy: 'automatic' }),
        (error: Error) => error.message.startsWith('iroh_native_error:transport-unavailable:malformed native lease field'),
    );

    const externalOrigin = {
        ...native,
        startHomeTunnel: async () => ({
            ...(await native.startHomeTunnel({
                homeServerIdentityId: 'srv_home_a',
                endpointId: ENDPOINT_ID,
                relayPolicy: 'automatic',
            })),
            runtimeOrigin: 'https://attacker.example.test',
        }),
    };
    await assert.rejects(
        createService(externalOrigin).startHomeTunnel({ homeServerIdentityId: 'srv_home_a', endpointId: ENDPOINT_ID, policy: 'automatic' }),
        (error: Error) => error.message.startsWith('iroh_native_error:transport-unavailable:malformed native lease field runtimeOrigin'),
    );

    const invalidObservedPath = {
        ...native,
        startHomeTunnel: async () => ({
            ...(await native.startHomeTunnel({
                homeServerIdentityId: 'srv_home_a',
                endpointId: ENDPOINT_ID,
                relayPolicy: 'automatic',
            })),
            observedPath: 'maybe',
        }),
    };
    await assert.rejects(
        createService(invalidObservedPath).startHomeTunnel({ homeServerIdentityId: 'srv_home_a', endpointId: ENDPOINT_ID, policy: 'automatic' }),
        (error: Error) => error.message.startsWith('iroh_native_error:transport-unavailable:malformed native lease field observedPath'),
    );
});

test('renderer request facts are validated fail closed before the native call', async () => {
    const { native, calls } = createNativeFake();
    const service = createService(native);

    await assert.rejects(
        service.startHomeTunnel({ endpointId: ENDPOINT_ID, policy: 'automatic' }),
        (error: Error) => error.message.startsWith('iroh_native_error:invalid-request:'),
    );
    await assert.rejects(
        service.startHomeTunnel({ homeServerIdentityId: 'srv_home_a', endpointId: ENDPOINT_ID, policy: 'relay-everything' }),
        (error: Error) => error.message.startsWith('iroh_native_error:invalid-request:'),
    );
    assert.deepEqual(calls.start, []);
});

test('the desktop iroh seam stays lifecycle-only: no byte or payload APIs at invoke seams', () => {
    const sources = [
        'src/main/commands/irohTunnel.ts',
        'src/main/commands/registry.ts',
        'src/preload/index.ts',
    ];
    const forbidden = ['Buffer', 'Uint8Array', 'ArrayBuffer', 'DataView', 'base64', 'atob', 'btoa', 'onTunnelBytes'];
    // The node:test script runs from the package root, so the source seam is
    // read at its authoritative location rather than the compiled copy.
    for (const relative of sources) {
        const text = readFileSync(join(process.cwd(), relative), 'utf8');
        for (const identifier of forbidden) {
            assert.doesNotMatch(text, new RegExp(`\\b${identifier}\\b`), `${relative} must not reference ${identifier}`);
        }
    }
});

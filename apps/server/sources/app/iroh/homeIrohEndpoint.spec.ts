import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseIrohEndpointDescriptorV1 } from '@happier-dev/protocol';
import { IrohError } from '@happier-dev/iroh-native';

vi.mock('@/utils/logging/log', () => ({ log: vi.fn() }));
vi.mock('@/app/serverIdentity/serverIdentity', () => ({
    getOrCreateServerIdentityId: vi.fn(async () => 'srv_iroh_owner_spec'),
}));

const VALID_ENDPOINT_ID = 'a'.repeat(64);
const DRIFTED_ENDPOINT_ID = 'b'.repeat(64);
const API_PORT = 3005;
const HOME_SERVER_IDENTITY_ID = 'srv_iroh_owner_spec';
const CANONICAL_SERVER_URL = 'https://home.example.test';
const DEFAULT_DIRECT_ADDRESSES = ['198.51.100.7:54321'];

type NativeLifecycle = NonNullable<
    Parameters<
        typeof import('./homeIrohEndpoint')['ensureHomeIrohEndpoint']
    >[0]['native']
>;

type NativeLifecycleMock = {
    [K in keyof NativeLifecycle]-?: Mock<NativeLifecycle[K]>;
};

function createNativeFake(overrides: Partial<NativeLifecycle> = {}): NativeLifecycleMock {
    const native = {
        createEndpoint: vi.fn(async (request: { keyPath: string; relayPolicy: string; relayUrls: readonly string[] }) => ({
            endpointHandle: request.keyPath,
            endpointId: VALID_ENDPOINT_ID,
            relayMode: request.relayPolicy === 'disabled' ? 'disabled' : 'custom',
            capProfile: 'homeInteractive',
            relayUrls: [...request.relayUrls],
        })),
        startHomeAcceptor: vi.fn(async (request: { endpointHandle: string; targetHost: string; targetPort: number }) => ({
            endpointHandle: request.endpointHandle,
            reused: false,
            status: { running: true },
        })),
        stopHomeAcceptor: vi.fn(async () => {}),
        getEndpointStatus: vi.fn(async () => ({
            endpointId: VALID_ENDPOINT_ID,
            directAddresses: [...DEFAULT_DIRECT_ADDRESSES],
            active: true,
        })),
        shutdownEndpoint: vi.fn(async () => {}),
        ...overrides,
    };
    return native as NativeLifecycleMock;
}

async function loadOwnerModule() {
    vi.resetModules();
    return await import('./homeIrohEndpoint');
}

function envFor(dataDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
        HAPPIER_CANONICAL_SERVER_URL: CANONICAL_SERVER_URL,
        HAPPIER_SERVER_LIGHT_DATA_DIR: dataDir,
        ...extra,
    };
}

function keyPathFor(dataDir: string): string {
    return join(dataDir, 'runtime', 'iroh', 'endpoint.key');
}

function continuityPathFor(dataDir: string): string {
    return join(dataDir, 'runtime', 'iroh', 'endpoint.descriptor.json');
}

async function writeContinuityFixture(dataDir: string, continuity: Record<string, unknown>): Promise<void> {
    await mkdir(join(dataDir, 'runtime', 'iroh'), { recursive: true });
    await writeFile(continuityPathFor(dataDir), `${JSON.stringify(continuity)}\n`, 'utf-8');
}

async function writeKeyFixture(dataDir: string): Promise<void> {
    await mkdir(join(dataDir, 'runtime', 'iroh'), { recursive: true });
    await writeFile(keyPathFor(dataDir), Buffer.alloc(32, 7));
}

function continuityFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        v: 1,
        homeServerIdentityId: HOME_SERVER_IDENTITY_ID,
        canonicalServerUrl: CANONICAL_SERVER_URL,
        endpointId: VALID_ENDPOINT_ID,
        relayUrls: [],
        directAddresses: [...DEFAULT_DIRECT_ADDRESSES],
        revision: 3,
        ...overrides,
    };
}

describe('home Iroh endpoint composition', () => {
    let dataDir: string;

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'home-iroh-owner-'));
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
    });

    it('composes one endpoint plus one fixed-loopback acceptor after the API listens and publishes the parsed descriptor snapshot', async () => {
        const owner = await loadOwnerModule();
        const native = createNativeFake();

        const state = await owner.ensureHomeIrohEndpoint({
            env: envFor(dataDir),
            apiPort: API_PORT,
            native,
        });

        expect(state.status).toBe('active');
        expect(state.failureReason).toBeNull();
        expect(state.snapshot).toEqual({
            homeServerIdentityId: HOME_SERVER_IDENTITY_ID,
            canonicalServerUrl: CANONICAL_SERVER_URL,
            revision: 1,
            endpoint: parseIrohEndpointDescriptorV1({
                endpointId: VALID_ENDPOINT_ID,
                directAddresses: [...DEFAULT_DIRECT_ADDRESSES],
            }),
        });
        await expect(owner.getHomeIrohEndpointState()).resolves.toEqual(state);

        expect(native.createEndpoint).toHaveBeenCalledTimes(1);
        expect(native.createEndpoint.mock.calls[0]?.[0]).toEqual({
            keyPath: keyPathFor(dataDir),
            // Unconfigured relay env resolves to the canonical default policy
            // `automatic` with no operator relay URLs.
            relayPolicy: 'automatic',
            relayUrls: [],
            capProfile: 'homeInteractive',
        });
        expect(native.startHomeAcceptor).toHaveBeenCalledTimes(1);
        expect(native.startHomeAcceptor.mock.calls[0]?.[0]).toEqual({
            endpointHandle: keyPathFor(dataDir),
            targetHost: '127.0.0.1',
            targetPort: API_PORT,
        });
        expect(native.shutdownEndpoint).not.toHaveBeenCalled();

        const continuity = JSON.parse(await readFile(continuityPathFor(dataDir), 'utf-8')) as Record<string, unknown>;
        expect(continuity).toEqual({
            v: 1,
            homeServerIdentityId: HOME_SERVER_IDENTITY_ID,
            canonicalServerUrl: CANONICAL_SERVER_URL,
            endpointId: VALID_ENDPOINT_ID,
            relayUrls: [],
            directAddresses: [...DEFAULT_DIRECT_ADDRESSES],
            revision: 1,
        });

        if (process.platform !== 'win32') {
            expect((await stat(continuityPathFor(dataDir))).mode & 0o777).toBe(0o600);
            expect((await stat(join(dataDir, 'runtime', 'iroh'))).mode & 0o777).toBe(0o700);
        }
    });

    it('materializes a fresh relocation endpoint above the source revision without starting Home ingress', async () => {
        const owner = await loadOwnerModule();
        const native = createNativeFake({
            createEndpoint: vi.fn(async (request: { keyPath: string; relayPolicy: string; relayUrls: readonly string[] }) => {
                await mkdir(join(dataDir, 'runtime', 'iroh'), { recursive: true });
                await writeFile(request.keyPath, Buffer.alloc(32, 9));
                return {
                    endpointHandle: request.keyPath,
                    endpointId: VALID_ENDPOINT_ID,
                    relayMode: request.relayPolicy === 'disabled' ? 'disabled' : 'custom',
                    capProfile: 'homeInteractive',
                    relayUrls: [...request.relayUrls],
                };
            }),
        });

        const result = await owner.materializeHomeIrohEndpointDescriptor({
            env: envFor(dataDir),
            sourceDescriptorRevision: 7,
            native,
        });

        expect(result).toEqual({
            status: 'ready',
            minimumOuterRevisionExclusive: 7,
            endpoint: parseIrohEndpointDescriptorV1({
                endpointId: VALID_ENDPOINT_ID,
                directAddresses: [...DEFAULT_DIRECT_ADDRESSES],
            }),
        });
        expect(native.startHomeAcceptor).not.toHaveBeenCalled();
        expect(native.shutdownEndpoint).toHaveBeenCalledWith({ endpointHandle: keyPathFor(dataDir) });

        const repeated = await owner.materializeHomeIrohEndpointDescriptor({
            env: envFor(dataDir),
            sourceDescriptorRevision: 7,
            native,
        });
        expect(repeated).toEqual(result);
        expect(native.startHomeAcceptor).not.toHaveBeenCalled();
        expect(native.shutdownEndpoint).toHaveBeenCalledTimes(2);

        const continuity = JSON.parse(await readFile(continuityPathFor(dataDir), 'utf-8')) as Record<string, unknown>;
        expect(continuity.revision).toBe(8);

        const active = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });
        expect(active.status).toBe('active');
        expect(active.snapshot?.revision).toBe(8);
        expect(native.startHomeAcceptor).toHaveBeenCalledTimes(1);
    });

    it('reuses the one active lifecycle for a repeated compatible ensure without binding duplicates', async () => {
        const owner = await loadOwnerModule();
        const native = createNativeFake();
        const env = envFor(dataDir);

        const first = await owner.ensureHomeIrohEndpoint({ env, apiPort: API_PORT, native });
        const second = await owner.ensureHomeIrohEndpoint({ env, apiPort: API_PORT, native });

        expect(second).toEqual(first);
        expect(native.createEndpoint).toHaveBeenCalledTimes(1);
        expect(native.startHomeAcceptor).toHaveBeenCalledTimes(1);
    });

    it('fails a repeated ensure with a typed conflict on incompatible configuration', async () => {
        const owner = await loadOwnerModule();
        const native = createNativeFake();

        await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        // The first ensure used the default `automatic` policy, so the
        // incompatible repeat must actually switch policy.
        await expect(owner.ensureHomeIrohEndpoint({
            env: envFor(dataDir, { HAPPIER_IROH_RELAY_POLICY: 'disabled' }),
            apiPort: API_PORT,
            native,
        })).rejects.toMatchObject({ name: 'IrohError', code: 'endpoint_config_conflict' });

        expect(native.createEndpoint).toHaveBeenCalledTimes(1);
    });

    it('carries explicit operator relay URLs to the native endpoint and into the descriptor', async () => {
        const owner = await loadOwnerModule();
        const native = createNativeFake();

        const state = await owner.ensureHomeIrohEndpoint({
            env: envFor(dataDir, {
                HAPPIER_IROH_RELAY_POLICY: 'automatic',
                HAPPIER_IROH_RELAY_URLS: 'https://relay-b.example.test, https://relay-a.example.test',
            }),
            apiPort: API_PORT,
            native,
        });

        expect(state.status).toBe('active');
        expect(native.createEndpoint.mock.calls[0]?.[0]).toEqual({
            keyPath: keyPathFor(dataDir),
            relayPolicy: 'automatic',
            relayUrls: ['https://relay-a.example.test', 'https://relay-b.example.test'],
            capProfile: 'homeInteractive',
        });
        expect(state.snapshot?.endpoint.relayUrls).toEqual([
            'https://relay-a.example.test',
            'https://relay-b.example.test',
        ]);
    });

    it('fails closed when the disabled relay policy is combined with operator relay URLs', async () => {
        const owner = await loadOwnerModule();
        const native = createNativeFake();

        const state = await owner.ensureHomeIrohEndpoint({
            env: envFor(dataDir, {
                HAPPIER_IROH_RELAY_POLICY: 'disabled',
                HAPPIER_IROH_RELAY_URLS: 'https://relay.example.test',
            }),
            apiPort: API_PORT,
            native,
        });

        expect(state).toEqual({ status: 'failed', snapshot: null, failureReason: 'invalid_iroh_config' });
        expect(native.createEndpoint).not.toHaveBeenCalled();
        expect(state.snapshot).toBeNull();
    });

    it('keeps relay query credentials out of the native transport and published descriptor', async () => {
        const owner = await loadOwnerModule();
        const native = createNativeFake();

        const state = await owner.ensureHomeIrohEndpoint({
            env: envFor(dataDir, {
                HAPPIER_IROH_RELAY_POLICY: 'automatic',
                HAPPIER_IROH_RELAY_URLS: 'https://relay.example.test?token=shared-secret',
            }),
            apiPort: API_PORT,
            native,
        });

        expect(state).toEqual({ status: 'failed', snapshot: null, failureReason: 'invalid_iroh_config' });
        expect(native.createEndpoint).not.toHaveBeenCalled();
    });

    it('requires the stable canonical Home auth audience from HAPPIER_CANONICAL_SERVER_URL', async () => {
        const owner = await loadOwnerModule();
        const native = createNativeFake();
        const env = envFor(dataDir);
        delete env.HAPPIER_CANONICAL_SERVER_URL;

        const state = await owner.ensureHomeIrohEndpoint({ env, apiPort: API_PORT, native });

        expect(state).toEqual({ status: 'failed', snapshot: null, failureReason: 'canonical_server_url_missing' });
        expect(native.createEndpoint).not.toHaveBeenCalled();
        expect(native.startHomeAcceptor).not.toHaveBeenCalled();
    });

    it('fails closed when continuity metadata is unreadable', async () => {
        await writeContinuityFixture(dataDir, { broken: true });
        const owner = await loadOwnerModule();
        const native = createNativeFake();

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        expect(state).toEqual({ status: 'failed', snapshot: null, failureReason: 'continuity_metadata_unreadable' });
        expect(native.createEndpoint).not.toHaveBeenCalled();
    });

    it('fails closed when continuity proves prior provisioning but the endpoint key is now lost', async () => {
        await writeContinuityFixture(dataDir, continuityFixture());
        const owner = await loadOwnerModule();
        const native = createNativeFake();

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        expect(state).toEqual({ status: 'failed', snapshot: null, failureReason: 'endpoint_key_lost' });
        expect(native.createEndpoint).not.toHaveBeenCalled();
        expect(native.shutdownEndpoint).not.toHaveBeenCalled();
        expect(JSON.parse(await readFile(continuityPathFor(dataDir), 'utf-8'))).toEqual(continuityFixture());
    });

    it('composes with revision 1 when the key exists but continuity was explicitly cleared', async () => {
        await writeKeyFixture(dataDir);
        const owner = await loadOwnerModule();
        const native = createNativeFake();

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        expect(state.status).toBe('active');
        expect(state.snapshot?.revision).toBe(1);
    });

    it('fails closed and cleans up on endpoint identity drift', async () => {
        await writeKeyFixture(dataDir);
        await writeContinuityFixture(dataDir, continuityFixture());
        const owner = await loadOwnerModule();
        const native = createNativeFake({
            createEndpoint: vi.fn(async (request: { keyPath: string; relayPolicy: string; relayUrls: readonly string[] }) => ({
                endpointHandle: request.keyPath,
                endpointId: DRIFTED_ENDPOINT_ID,
                relayMode: 'disabled',
                capProfile: 'homeInteractive',
                relayUrls: [...request.relayUrls],
            })),
            getEndpointStatus: vi.fn(async () => ({
                endpointId: DRIFTED_ENDPOINT_ID,
                directAddresses: [...DEFAULT_DIRECT_ADDRESSES],
                active: true,
            })),
        });

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        expect(state).toEqual({ status: 'failed', snapshot: null, failureReason: 'endpoint_identity_drift' });
        expect(native.shutdownEndpoint).toHaveBeenCalledWith({ endpointHandle: keyPathFor(dataDir) });
        expect(native.startHomeAcceptor).not.toHaveBeenCalled();
        expect(JSON.parse(await readFile(continuityPathFor(dataDir), 'utf-8'))).toEqual(continuityFixture());
    });

    it('bumps the descriptor revision when direct addresses change', async () => {
        await writeKeyFixture(dataDir);
        await writeContinuityFixture(dataDir, continuityFixture());
        const owner = await loadOwnerModule();
        const native = createNativeFake({
            getEndpointStatus: vi.fn(async () => ({
                endpointId: VALID_ENDPOINT_ID,
                directAddresses: ['198.51.100.9:54321'],
                active: true,
            })),
        });

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        expect(state.status).toBe('active');
        expect(state.snapshot?.revision).toBe(4);
        expect(state.snapshot?.endpoint.directAddresses).toEqual(['198.51.100.9:54321']);
        const continuity = JSON.parse(await readFile(continuityPathFor(dataDir), 'utf-8')) as Record<string, unknown>;
        expect(continuity.revision).toBe(4);
        expect(continuity.directAddresses).toEqual(['198.51.100.9:54321']);
    });

    it('bumps the descriptor revision when the canonical Home URL changes', async () => {
        await writeKeyFixture(dataDir);
        await writeContinuityFixture(dataDir, continuityFixture());
        const owner = await loadOwnerModule();
        const native = createNativeFake();
        const nextCanonicalServerUrl = 'https://moved-home.example.test';

        const state = await owner.ensureHomeIrohEndpoint({
            env: envFor(dataDir, { HAPPIER_CANONICAL_SERVER_URL: nextCanonicalServerUrl }),
            apiPort: API_PORT,
            native,
        });

        expect(state.status).toBe('active');
        expect(state.snapshot?.canonicalServerUrl).toBe(nextCanonicalServerUrl);
        expect(state.snapshot?.revision).toBe(4);
        const continuity = JSON.parse(await readFile(continuityPathFor(dataDir), 'utf-8')) as Record<string, unknown>;
        expect(continuity.canonicalServerUrl).toBe(nextCanonicalServerUrl);
        expect(continuity.revision).toBe(4);
    });

    it('fails closed when persisted Home identity continuity no longer matches the Home owner', async () => {
        await writeKeyFixture(dataDir);
        await writeContinuityFixture(dataDir, continuityFixture({
            homeServerIdentityId: 'srv_previous_home_identity',
        }));
        const owner = await loadOwnerModule();
        const native = createNativeFake();

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        expect(state).toEqual({ status: 'failed', snapshot: null, failureReason: 'home_identity_drift' });
        expect(native.createEndpoint).not.toHaveBeenCalled();
        expect(native.startHomeAcceptor).not.toHaveBeenCalled();
        expect(JSON.parse(await readFile(continuityPathFor(dataDir), 'utf-8'))).toEqual(continuityFixture({
            homeServerIdentityId: 'srv_previous_home_identity',
        }));
    });

    it('keeps the descriptor revision when the composition inputs are unchanged', async () => {
        await writeKeyFixture(dataDir);
        await writeContinuityFixture(dataDir, continuityFixture());
        const owner = await loadOwnerModule();
        const native = createNativeFake();

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        expect(state.status).toBe('active');
        expect(state.snapshot?.revision).toBe(3);
    });

    it('fails closed when the native endpoint never becomes active', async () => {
        const owner = await loadOwnerModule();
        const native = createNativeFake({
            getEndpointStatus: vi.fn(async () => ({
                endpointId: VALID_ENDPOINT_ID,
                directAddresses: [...DEFAULT_DIRECT_ADDRESSES],
                active: false,
            })),
        });

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        expect(state).toEqual({ status: 'failed', snapshot: null, failureReason: 'endpoint_not_active' });
        expect(native.startHomeAcceptor).not.toHaveBeenCalled();
        expect(native.shutdownEndpoint).toHaveBeenCalledWith({ endpointHandle: keyPathFor(dataDir) });
        await expect(readFile(continuityPathFor(dataDir), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('fails closed when the fixed acceptor does not start', async () => {
        const owner = await loadOwnerModule();
        const native = createNativeFake({
            startHomeAcceptor: vi.fn(async (request: { endpointHandle: string }) => ({
                endpointHandle: request.endpointHandle,
                reused: false,
                status: { running: false },
            })),
        });

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        expect(state).toEqual({ status: 'failed', snapshot: null, failureReason: 'acceptor_not_running' });
        expect(native.stopHomeAcceptor).toHaveBeenCalledWith({ endpointHandle: keyPathFor(dataDir) });
        expect(native.shutdownEndpoint).toHaveBeenCalledWith({ endpointHandle: keyPathFor(dataDir) });
        expect(state.snapshot).toBeNull();
    });

    it('fails closed when the native descriptor payload cannot be parsed by the protocol parser', async () => {
        const owner = await loadOwnerModule();
        const native = createNativeFake({
            createEndpoint: vi.fn(async (request: { keyPath: string; relayPolicy: string; relayUrls: readonly string[] }) => ({
                endpointHandle: request.keyPath,
                endpointId: 'not-a-valid-endpoint-id',
                relayMode: 'disabled',
                capProfile: 'homeInteractive',
                relayUrls: [...request.relayUrls],
            })),
            getEndpointStatus: vi.fn(async () => ({
                endpointId: 'not-a-valid-endpoint-id',
                directAddresses: [...DEFAULT_DIRECT_ADDRESSES],
                active: true,
            })),
        });

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        expect(state).toEqual({ status: 'failed', snapshot: null, failureReason: 'descriptor_invalid' });
        expect(native.shutdownEndpoint).toHaveBeenCalledWith({ endpointHandle: keyPathFor(dataDir) });
        expect(state.snapshot).toBeNull();
    });

    it('fails closed when the API listen port is unavailable', async () => {
        const owner = await loadOwnerModule();
        const native = createNativeFake();

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: null, native });

        expect(state).toEqual({ status: 'failed', snapshot: null, failureReason: 'api_listen_port_unavailable' });
        expect(native.createEndpoint).not.toHaveBeenCalled();
    });

    it('reports honest unavailability without failing the process when the native transport is absent and Iroh is not explicitly configured', async () => {
        const owner = await loadOwnerModule();

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native: null });

        expect(state).toEqual({ status: 'unavailable', snapshot: null, failureReason: null });
        await expect(owner.getHomeIrohEndpointState()).resolves.toEqual({
            status: 'unavailable',
            snapshot: null,
            failureReason: null,
        });
    });

    it('reports honest unavailability when relay policy and URLs are configured but the native transport is absent', async () => {
        const owner = await loadOwnerModule();

        const state = await owner.ensureHomeIrohEndpoint({
            env: envFor(dataDir, {
                HAPPIER_IROH_RELAY_POLICY: 'automatic',
                HAPPIER_IROH_RELAY_URLS: 'https://relay.example.test',
            }),
            apiPort: API_PORT,
            native: null,
        });

        expect(state).toEqual({ status: 'unavailable', snapshot: null, failureReason: null });
        await expect(owner.getHomeIrohEndpointState()).resolves.toEqual(state);
    });

    it('clears the published snapshot first, then stops the acceptor, then shuts the endpoint down', async () => {
        const owner = await loadOwnerModule();
        const order: string[] = [];
        const native = createNativeFake({
            stopHomeAcceptor: vi.fn(async () => {
                order.push('stopHomeAcceptor');
            }),
            shutdownEndpoint: vi.fn(async () => {
                order.push('shutdownEndpoint');
            }),
        });
        await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        await owner.stopHomeIrohEndpoint();

        expect(order).toEqual(['stopHomeAcceptor', 'shutdownEndpoint']);
        expect(native.stopHomeAcceptor).toHaveBeenCalledWith({ endpointHandle: keyPathFor(dataDir) });
        expect(native.shutdownEndpoint).toHaveBeenCalledWith({ endpointHandle: keyPathFor(dataDir) });
        await expect(owner.getHomeIrohEndpointState()).resolves.toEqual({
            status: 'not-composed',
            snapshot: null,
            failureReason: null,
        });

        await owner.stopHomeIrohEndpoint();
        expect(native.shutdownEndpoint).toHaveBeenCalledTimes(1);
    });

    it('keeps the endpoint owned when shutdown cleanup rejects, refuses new work meanwhile, and disposes it on retry', async () => {
        await writeKeyFixture(dataDir);
        const owner = await loadOwnerModule();
        let failShutdown = true;
        const native = createNativeFake({
            shutdownEndpoint: vi.fn(async () => {
                if (failShutdown) {
                    failShutdown = false;
                    throw new Error('native endpoint shutdown failed');
                }
            }),
        });
        const env = envFor(dataDir);
        await owner.ensureHomeIrohEndpoint({ env, apiPort: API_PORT, native });

        await expect(owner.stopHomeIrohEndpoint()).rejects.toThrow('native endpoint shutdown failed');
        expect(native.stopHomeAcceptor).toHaveBeenCalledTimes(1);
        expect(native.shutdownEndpoint).toHaveBeenCalledTimes(1);

        // The retained native resource refuses new composition work instead of
        // creating a second owner.
        const refused = await owner.ensureHomeIrohEndpoint({ env, apiPort: API_PORT, native });
        expect(refused).toEqual({ status: 'failed', snapshot: null, failureReason: 'endpoint_cleanup_pending' });
        expect(native.createEndpoint).toHaveBeenCalledTimes(1);
        await expect(owner.materializeHomeIrohEndpointDescriptor({
            env,
            sourceDescriptorRevision: 7,
            native,
        })).resolves.toEqual({ status: 'failed', failureReason: 'endpoint_cleanup_pending' });

        // A later disposal retries only the unsettled step.
        await owner.stopHomeIrohEndpoint();
        expect(native.stopHomeAcceptor).toHaveBeenCalledTimes(1);
        expect(native.shutdownEndpoint).toHaveBeenCalledTimes(2);

        const recomposed = await owner.ensureHomeIrohEndpoint({ env, apiPort: API_PORT, native });
        expect(recomposed.status).toBe('active');
        expect(native.createEndpoint).toHaveBeenCalledTimes(2);
    });

    it('shares one in-flight cleanup between concurrent stops without caching the rejected attempt', async () => {
        const owner = await loadOwnerModule();
        let failShutdown = true;
        const native = createNativeFake({
            shutdownEndpoint: vi.fn(async () => {
                if (failShutdown) {
                    failShutdown = false;
                    throw new Error('native endpoint shutdown failed');
                }
            }),
        });
        await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        const outcomes = await Promise.allSettled([owner.stopHomeIrohEndpoint(), owner.stopHomeIrohEndpoint()]);
        expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
        expect(native.shutdownEndpoint).toHaveBeenCalledTimes(1);

        await owner.stopHomeIrohEndpoint();
        expect(native.shutdownEndpoint).toHaveBeenCalledTimes(2);
    });

    it('waits for an admitted composition and prevents its late acceptor from publishing after stop', async () => {
        const owner = await loadOwnerModule();
        let resolveAcceptor: ((value: { endpointHandle: string; reused: false; status: { running: true } }) => void) | null = null;
        const native = createNativeFake({
            startHomeAcceptor: vi.fn(async (request: { endpointHandle: string }) => await new Promise((resolve) => {
                resolveAcceptor = resolve;
            })),
        });

        const ensure = owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });
        await vi.waitFor(() => expect(resolveAcceptor).toBeTypeOf('function'));

        let stopSettled = false;
        const stop = owner.stopHomeIrohEndpoint().then(() => {
            stopSettled = true;
        });
        await Promise.resolve();
        expect(stopSettled).toBe(false);

        resolveAcceptor!({
            endpointHandle: keyPathFor(dataDir),
            reused: false,
            status: { running: true },
        });
        await expect(ensure).resolves.toMatchObject({ status: 'not-composed' });
        await stop;

        await expect(owner.getHomeIrohEndpointState()).resolves.toEqual({
            status: 'not-composed',
            snapshot: null,
            failureReason: null,
        });
        expect(native.stopHomeAcceptor).toHaveBeenCalledTimes(1);
        expect(native.shutdownEndpoint).toHaveBeenCalledTimes(1);
    });

    it('keeps a rejected startup-failure cleanup owned and retryable', async () => {
        const owner = await loadOwnerModule();
        let failShutdown = true;
        const native = createNativeFake({
            startHomeAcceptor: vi.fn(async (request: { endpointHandle: string }) => ({
                endpointHandle: request.endpointHandle,
                reused: false,
                status: { running: false },
            })),
            shutdownEndpoint: vi.fn(async () => {
                if (failShutdown) {
                    failShutdown = false;
                    throw new Error('native endpoint shutdown failed');
                }
            }),
        });

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        expect(state).toEqual({ status: 'failed', snapshot: null, failureReason: 'acceptor_not_running' });
        expect(native.shutdownEndpoint).toHaveBeenCalledTimes(1);

        await owner.stopHomeIrohEndpoint();
        expect(native.stopHomeAcceptor).toHaveBeenCalledTimes(1);
        expect(native.shutdownEndpoint).toHaveBeenCalledTimes(2);
    });

    it('maps a native config conflict to a typed fail-closed result', async () => {
        const owner = await loadOwnerModule();
        const native = createNativeFake({
            createEndpoint: vi.fn(async () => {
                throw new IrohError('endpoint_config_conflict', 'endpoint identity already bound');
            }),
        });

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        expect(state).toEqual({ status: 'failed', snapshot: null, failureReason: 'endpoint_config_conflict' });
        expect(state.snapshot).toBeNull();
    });

    it('maps a native endpoint key failure to a typed fail-closed result', async () => {
        const owner = await loadOwnerModule();
        const native = createNativeFake({
            createEndpoint: vi.fn(async () => {
                throw new Error('endpoint_key_unavailable: endpoint identity key is missing or corrupt');
            }),
        });

        const state = await owner.ensureHomeIrohEndpoint({ env: envFor(dataDir), apiPort: API_PORT, native });

        expect(state).toEqual({ status: 'failed', snapshot: null, failureReason: 'endpoint_key_unavailable' });
    });

    describe('resolveHomeIrohAcceptorPort', () => {
        it('derives the actual bound port from the Fastify server address', async () => {
            const owner = await loadOwnerModule();
            const api = { server: { address: () => ({ address: '0.0.0.0', family: 'IPv4', port: API_PORT }) } };
            expect(owner.resolveHomeIrohAcceptorPort(api)).toBe(API_PORT);
        });

        it('fails closed on a missing, string, or zero port', async () => {
            const owner = await loadOwnerModule();
            expect(owner.resolveHomeIrohAcceptorPort({ server: { address: () => null } })).toBeNull();
            expect(owner.resolveHomeIrohAcceptorPort({ server: { address: () => '/tmp/api.sock' } })).toBeNull();
            expect(owner.resolveHomeIrohAcceptorPort({
                server: { address: () => ({ address: '0.0.0.0', family: 'IPv4', port: 0 }) },
            })).toBeNull();
        });
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
});

function createNodeNativeModule() {
    return {
        getAvailability: vi.fn(() => ({ available: true, os: 'test', arch: 'test', engine: 'node', surface: [] })),
        startHomeTunnel: vi.fn(),
        stopHomeTunnel: vi.fn(),
        getHomeTunnelStatus: vi.fn(),
        createEndpoint: vi.fn(async () => ({
            endpointHandle: 'endpoint-1',
            endpointId: 'a'.repeat(64),
            relayMode: 'disabled' as const,
            capProfile: 'homeInteractive',
            relayUrls: [],
        })),
        startHomeAcceptor: vi.fn(async () => ({
            endpointHandle: 'endpoint-1',
            reused: false,
            status: { running: true },
        })),
        stopHomeAcceptor: vi.fn(async () => undefined),
        ensureHomeTunnel: vi.fn(),
        releaseHomeTunnel: vi.fn(),
        shutdownEndpoint: vi.fn(async () => undefined),
        getEndpointStatus: vi.fn(async () => ({
            endpointHandle: 'endpoint-1',
            endpointId: 'a'.repeat(64),
            relayMode: 'disabled',
            relayUrls: [],
            capProfile: 'homeInteractive',
            directAddresses: ['127.0.0.1:4242'],
            active: true,
        })),
        getTunnelStatus: vi.fn(),
    };
}

describe('Home Iroh Node/Bun native lifecycle binding', () => {
    it('loads the Node addon surface and adapts its handle-based lifecycle exactly once', async () => {
        const native = createNodeNativeModule();
        const loadIrohNodeNative = vi.fn(() => ({
            available: true as const,
            native,
            addonPath: '/package/native/iroh.node',
        }));
        vi.doMock('@happier-dev/iroh-native/node', () => ({ loadIrohNodeNative }));

        const { loadHomeIrohNativeLifecycle } = await import('./homeIrohNativeLifecycle');
        const lifecycle = loadHomeIrohNativeLifecycle();
        expect(lifecycle).not.toBeNull();
        expect(loadIrohNodeNative).toHaveBeenCalledTimes(1);

        await expect(lifecycle!.getEndpointStatus({ endpointHandle: 'endpoint-1' })).resolves.toMatchObject({
            endpointId: 'a'.repeat(64),
            directAddresses: ['127.0.0.1:4242'],
            active: true,
        });
        expect(native.getEndpointStatus).toHaveBeenCalledWith('endpoint-1');
    });

    it('reports the carrier unavailable when the deterministic Node addon cannot be loaded', async () => {
        vi.doMock('@happier-dev/iroh-native/node', () => ({
            loadIrohNodeNative: () => ({
                available: false as const,
                reason: 'native_unavailable' as const,
                message: 'missing target addon',
                addonPath: null,
            }),
        }));

        const { loadHomeIrohNativeLifecycle } = await import('./homeIrohNativeLifecycle');
        expect(loadHomeIrohNativeLifecycle()).toBeNull();
    });
});

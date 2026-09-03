import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeBoundary = vi.hoisted(() => ({
    current: null as Record<string, unknown> | null,
    ensureApplicationEndpoint: vi.fn(),
}));

vi.mock('@happier-dev/iroh-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@happier-dev/iroh-native')>();
    return {
        ...actual,
        getOptionalHappierIrohNativeModule: () => nativeBoundary.current,
        ensureIrohApplicationEndpoint: (...args: unknown[]) => nativeBoundary.ensureApplicationEndpoint(...args),
    };
});

import {
    getIrohApplicationEndpoint,
    isIrohMachineHttpLifecycleAvailable,
    probeIrohMachineHttpLifecycleAvailability,
    readRetainedIrohMachineHttpLeaseIds,
    releaseRetainedIrohMachineHttpLeases,
    startIrohMachineHttpTunnel,
} from './machineHttpLifecycle';

const ENDPOINT_ID = 'b'.repeat(64);

describe('machine Iroh lifecycle availability and application endpoint ownership', () => {
    const originalInternals = (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    const originalNavigator = (globalThis as Record<string, unknown>).navigator;

    beforeEach(() => {
        nativeBoundary.current = null;
        nativeBoundary.ensureApplicationEndpoint.mockReset();
        delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
        (globalThis as Record<string, unknown>).navigator = { userAgent: 'test-mobile' };
    });

    afterEach(() => {
        if (originalInternals === undefined) delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
        else (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = originalInternals;
        (globalThis as Record<string, unknown>).navigator = originalNavigator;
    });

    it('reports mobile unavailable when the registered module engine is absent', async () => {
        nativeBoundary.current = {
            getAvailability: () => ({ available: false }),
            createEndpoint: vi.fn(),
            startMachineHttpTunnel: vi.fn(),
            stopMachineTunnel: vi.fn(),
        };
        expect(isIrohMachineHttpLifecycleAvailable()).toBe(false);
        await expect(probeIrohMachineHttpLifecycleAvailability()).resolves.toBe(false);
    });

    it.each([
        ['electron', false],
        ['tauri', true],
    ] as const)('probes the real %s host availability command before selection', async (hostKind, available) => {
        const invoke = vi.fn(async (command: string) => {
            expect(command).toBe('iroh_get_availability');
            return { available };
        });
        (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke };
        (globalThis as Record<string, unknown>).navigator = {
            userAgent: hostKind === 'electron' ? 'Electron/43.4.0' : 'Tauri/2.0',
        };

        expect(isIrohMachineHttpLifecycleAvailable()).toBe(false);
        await expect(probeIrohMachineHttpLifecycleAvailability()).resolves.toBe(available);
        expect(isIrohMachineHttpLifecycleAvailable()).toBe(available);
    });

    it('uses the shared mobile application endpoint owner for machine identity and tunnel startup', async () => {
        const native = {
            getAvailability: () => ({ available: true }),
            createEndpoint: vi.fn(),
            startMachineHttpTunnel: vi.fn(async () => ({
                machineTunnelId: 'machine-1',
                localPort: 48123,
                localCapability: 'c'.repeat(64),
            })),
            stopMachineTunnel: vi.fn(async () => undefined),
        };
        nativeBoundary.current = native;
        nativeBoundary.ensureApplicationEndpoint.mockResolvedValue({
            endpointHandle: 'shared-mobile-endpoint',
            endpointId: ENDPOINT_ID,
        });

        await expect(getIrohApplicationEndpoint({
            policy: 'disabled',
            relayUrls: [],
        })).resolves.toEqual({ endpointId: ENDPOINT_ID });
        await startIrohMachineHttpTunnel({
            policy: 'disabled',
            endpointId: 'a'.repeat(64),
            directAddresses: ['127.0.0.1:48124'],
            relayUrls: [],
            handshakeJson: '{}',
        });

        expect(nativeBoundary.ensureApplicationEndpoint).toHaveBeenCalledTimes(2);
        expect(nativeBoundary.ensureApplicationEndpoint).toHaveBeenNthCalledWith(1, native, {
            policy: 'disabled',
            relayUrls: [],
        });
        expect(nativeBoundary.ensureApplicationEndpoint).toHaveBeenNthCalledWith(2, native, {
            policy: 'disabled',
            relayUrls: [],
        });
        expect(native.startMachineHttpTunnel).toHaveBeenCalledWith(expect.objectContaining({
            endpointHandle: 'shared-mobile-endpoint',
            capProfile: 'machineBulk',
        }));
    });
});

describe('machine Iroh HTTP lease cleanup custody', () => {
    const originalNavigator = (globalThis as Record<string, unknown>).navigator;

    function mountMobileNative(input: Readonly<{
        stopMachineTunnel: (leaseId: string) => Promise<void>;
        startMachineHttpTunnel?: () => Promise<Readonly<{
            machineTunnelId: string;
            localPort: number;
            localCapability: string;
        }>>;
    }>) {
        let startedTunnels = 0;
        const native = {
            getAvailability: () => ({ available: true }),
            createEndpoint: vi.fn(),
            startMachineHttpTunnel: vi.fn(input.startMachineHttpTunnel ?? (async () => {
                startedTunnels += 1;
                return {
                    machineTunnelId: `machine-${startedTunnels}`,
                    localPort: 48_122 + startedTunnels,
                    localCapability: 'c'.repeat(64),
                };
            })),
            stopMachineTunnel: vi.fn(input.stopMachineTunnel),
        };
        nativeBoundary.current = native;
        nativeBoundary.ensureApplicationEndpoint.mockResolvedValue({
            endpointHandle: 'shared-mobile-endpoint',
            endpointId: ENDPOINT_ID,
        });
        return native;
    }

    async function startLease() {
        return await startIrohMachineHttpTunnel({
            endpointId: 'a'.repeat(64),
            handshakeJson: '{}',
        });
    }

    beforeEach(() => {
        nativeBoundary.current = null;
        nativeBoundary.ensureApplicationEndpoint.mockReset();
        delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
        (globalThis as Record<string, unknown>).navigator = { userAgent: 'test-mobile' };
    });

    afterEach(async () => {
        await releaseRetainedIrohMachineHttpLeases().catch(() => undefined);
        (globalThis as Record<string, unknown>).navigator = originalNavigator;
    });

    it('retains a lease whose native stop failed and retries it on a later release', async () => {
        let stopAttempts = 0;
        const native = mountMobileNative({
            stopMachineTunnel: async () => {
                stopAttempts += 1;
                if (stopAttempts === 1) throw new Error('native machine tunnel stop failed');
            },
        });

        const lease = await startLease();
        await expect(lease.release()).rejects.toThrow('native machine tunnel stop failed');
        expect(native.stopMachineTunnel).toHaveBeenCalledTimes(1);
        expect(readRetainedIrohMachineHttpLeaseIds()).toEqual([lease.leaseId]);

        await expect(lease.release()).resolves.toBeUndefined();
        expect(native.stopMachineTunnel).toHaveBeenCalledTimes(2);
        expect(readRetainedIrohMachineHttpLeaseIds()).toEqual([]);

        // A released lease is no longer owned, so a redundant release is inert.
        await lease.release();
        expect(native.stopMachineTunnel).toHaveBeenCalledTimes(2);
    });

    it('coalesces concurrent releases of one lease into a single native stop', async () => {
        let releaseStop!: () => void;
        const stopGate = new Promise<void>((resolve) => {
            releaseStop = resolve;
        });
        const native = mountMobileNative({ stopMachineTunnel: async () => await stopGate });

        const lease = await startLease();
        const first = lease.release();
        const second = lease.release();
        releaseStop();
        await Promise.all([first, second]);

        expect(native.stopMachineTunnel).toHaveBeenCalledTimes(1);
        expect(readRetainedIrohMachineHttpLeaseIds()).toEqual([]);
    });

    it('retries a retained lease when the next machine tunnel is started', async () => {
        let stopAttempts = 0;
        const native = mountMobileNative({
            stopMachineTunnel: async () => {
                stopAttempts += 1;
                if (stopAttempts === 1) throw new Error('native machine tunnel stop failed');
            },
        });

        const first = await startLease();
        await expect(first.release()).rejects.toThrow('native machine tunnel stop failed');
        expect(readRetainedIrohMachineHttpLeaseIds()).toEqual([first.leaseId]);

        const second = await startLease();

        expect(native.stopMachineTunnel).toHaveBeenNthCalledWith(2, first.leaseId);
        expect(readRetainedIrohMachineHttpLeaseIds()).toEqual([]);
        // The retry never disturbs the lease the new transfer just acquired.
        expect(second.leaseId).not.toBe(first.leaseId);
        expect(native.stopMachineTunnel).toHaveBeenCalledTimes(2);

        await second.release();
        expect(native.stopMachineTunnel).toHaveBeenCalledTimes(3);
    });

    it('rejects a new start when retained cleanup still fails', async () => {
        let stopAttempts = 0;
        const native = mountMobileNative({
            stopMachineTunnel: async () => {
                stopAttempts += 1;
                if (stopAttempts <= 2) throw new Error('native machine tunnel stop still failing');
            },
        });

        const first = await startLease();
        await expect(first.release()).rejects.toThrow('native machine tunnel stop still failing');

        await expect(startLease()).rejects.toThrow('native machine tunnel stop still failing');
        expect(native.stopMachineTunnel).toHaveBeenCalledTimes(2);
        expect(native.startMachineHttpTunnel).toHaveBeenCalledTimes(1);
        expect(readRetainedIrohMachineHttpLeaseIds()).toEqual([first.leaseId]);
    });

    it('takes cleanup custody when native returns a lease id with malformed connection facts', async () => {
        let stopAttempts = 0;
        const native = mountMobileNative({
            startMachineHttpTunnel: async () => ({
                machineTunnelId: 'malformed-machine-lease',
                localPort: 0,
                localCapability: 'not-a-capability',
            }),
            stopMachineTunnel: async () => {
                stopAttempts += 1;
                if (stopAttempts === 1) throw new Error('malformed lease stop failed');
            },
        });

        await expect(startLease()).rejects.toThrow('Iroh machine HTTP lease is unavailable');
        expect(native.stopMachineTunnel).toHaveBeenCalledWith('malformed-machine-lease');
        expect(readRetainedIrohMachineHttpLeaseIds()).toEqual(['malformed-machine-lease']);

        const { disposeIrohHomeTunnelRuntime } = await import('./runtime');
        await disposeIrohHomeTunnelRuntime();
        expect(native.stopMachineTunnel).toHaveBeenCalledTimes(2);
        expect(readRetainedIrohMachineHttpLeaseIds()).toEqual([]);
    });
});

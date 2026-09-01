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

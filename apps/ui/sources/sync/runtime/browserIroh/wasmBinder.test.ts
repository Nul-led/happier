import { describe, expect, it } from 'vitest';

import { createBrowserIrohWasmBinder } from './wasmBinder';

const SEED = new Uint8Array(32).fill(9);
const RELAY = 'https://relay.happier.test';

/**
 * Stands in for the generated wasm-bindgen module. wasm-bindgen exports a
 * class, not a plain object, so the export here is a class with a static
 * `create` and prototype probe methods — the exact shape the boundary check
 * requires. `create` copies the seed synchronously when invoked — the real
 * boundary converts the JS `Uint8Array` into wasm linear memory before its
 * returned Promise settles — and keeps that copy so a test can tell "zeroed
 * too early" (the copy would be zeros) from "zeroed after the boundary
 * consumed it".
 */
function createFakeModule() {
    const created: { seedCopy: Uint8Array }[] = [];
    const closedConnections: string[] = [];

    class FakeHappierBrowserIrohProbe {
        static create(secretKey: Uint8Array, _relayUrls: string[]): Promise<unknown> {
            created.push({ seedCopy: new Uint8Array(secretKey) });
            return createImpl();
        }

        // The full shape `narrowProbe` requires of a created probe, so a
        // failure here can only be about the behavior under test, not the
        // boundary check.
        endpointId(): string {
            return 'endpoint-fake';
        }

        appliedRelayUrls(): string[] {
            return [];
        }

        async applyRelayUrls(_relayUrls: string[]): Promise<void> {}

        async openIncrementalHomeTunnelStream(_endpointId: string, _relayUrls: string[]): Promise<number> {
            return 1;
        }

        async openIncrementalMachineStream(_endpointId: string, _relayUrls: string[]): Promise<number> {
            return 2;
        }

        streamRemoteEndpointId(_streamHandle: number): string {
            return 'endpoint-remote';
        }

        streamObservedPath(_streamHandle: number): string {
            return 'relay';
        }

        async readStream(_streamHandle: number, _maxBytes: number): Promise<Uint8Array | null> {
            return null;
        }

        async writeStream(_streamHandle: number, _bytes: Uint8Array): Promise<void> {}

        async finishStreamWrite(_streamHandle: number): Promise<void> {}

        cancelStream(_streamHandle: number): void {}

        async closeStream(_streamHandle: number): Promise<void> {}

        closeHomeTunnelConnection(endpointId: string): void {
            closedConnections.push(`home:${endpointId}`);
        }

        closeMachineConnection(endpointId: string): void {
            closedConnections.push(`machine:${endpointId}`);
        }

        async close(): Promise<void> {}
    }

    let createImpl: () => Promise<unknown> = async () => new FakeHappierBrowserIrohProbe();

    const module = {
        default: async () => 'initialized',
        HappierBrowserIrohProbe: FakeHappierBrowserIrohProbe,
    };

    return {
        module,
        created,
        closedConnections,
        failCreateWith: (error: Error) => {
            createImpl = async () => {
                throw error;
            };
        },
    };
}

describe('sync/runtime/browserIroh/wasmBinder', () => {
    it('zeroes the JS seed only after the create boundary has consumed it, on success', async () => {
        const fake = createFakeModule();
        const binder = createBrowserIrohWasmBinder(async () => ({ module: fake.module, wasmUrl: 'wasm-url' }));
        const seed = new Uint8Array(SEED);

        const handle = await binder({ secretKey: seed, relayUrls: [RELAY] });

        expect(handle.endpointId).toBe('endpoint-fake');
        // The boundary saw the real seed, not a zeroed buffer.
        expect(fake.created).toHaveLength(1);
        expect(fake.created[0]!.seedCopy).toEqual(SEED);
        // And the JS copy is wiped once the boundary has taken it.
        expect(seed.every((byte) => byte === 0)).toBe(true);
    });

    it('zeroes the JS seed when the create boundary rejects', async () => {
        const fake = createFakeModule();
        fake.failCreateWith(new Error('bind failed'));
        const binder = createBrowserIrohWasmBinder(async () => ({ module: fake.module, wasmUrl: 'wasm-url' }));
        const seed = new Uint8Array(SEED);

        await expect(binder({ secretKey: seed, relayUrls: [RELAY] })).rejects.toThrow('bind failed');
        expect(fake.created[0]!.seedCopy).toEqual(SEED);
        expect(seed.every((byte) => byte === 0)).toBe(true);
    });

    it('zeroes the JS seed when the create boundary throws synchronously', async () => {
        const fake = createFakeModule();
        fake.module.HappierBrowserIrohProbe.create = () => {
            throw new Error('wasm trap');
        };
        const binder = createBrowserIrohWasmBinder(async () => ({ module: fake.module, wasmUrl: 'wasm-url' }));
        const seed = new Uint8Array(SEED);

        await expect(binder({ secretKey: seed, relayUrls: [RELAY] })).rejects.toThrow('wasm trap');
        expect(seed.every((byte) => byte === 0)).toBe(true);
    });

    it('does not touch the seed before module initialization completes', async () => {
        // The boundary has not run yet while initialization is pending, so the
        // seed must still hold the identity when create is eventually invoked.
        const fake = createFakeModule();
        const binder = createBrowserIrohWasmBinder(async () => ({ module: fake.module, wasmUrl: 'wasm-url' }));
        const seed = new Uint8Array(SEED);

        const binding = binder({ secretKey: seed, relayUrls: [RELAY] });
        // Both awaits (load + init) are queued microtasks; the seed must still
        // be intact at this synchronous point, and the boundary must receive it
        // intact, which the success assertion below observes.
        await expect(binding).resolves.toMatchObject({ endpointId: 'endpoint-fake' });
        expect(fake.created[0]!.seedCopy).toEqual(SEED);
    });

    it('routes typed connection release to the protocol-specific wasm operation', async () => {
        const fake = createFakeModule();
        const binder = createBrowserIrohWasmBinder(async () => ({ module: fake.module, wasmUrl: 'wasm-url' }));
        const handle = await binder({ secretKey: new Uint8Array(SEED), relayUrls: [RELAY] });

        await handle.closeConnection({ streamKind: 'home', endpointId: 'home-endpoint' });
        await handle.closeConnection({ streamKind: 'machine', endpointId: 'machine-endpoint' });

        expect(fake.closedConnections).toEqual([
            'home:home-endpoint',
            'machine:machine-endpoint',
        ]);
    });
});

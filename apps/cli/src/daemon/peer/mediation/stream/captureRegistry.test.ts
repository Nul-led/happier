import { describe, expect, it } from 'vitest';

import { unavailableMachineLiveStreamCaptureAdapter } from './captureAdapter';
import { createMachineLiveStreamCaptureRegistry } from './captureRegistry';

describe('createMachineLiveStreamCaptureRegistry', () => {
    it('requires an exact source when a family contains multiple views and checks that source belongs to the family', () => {
        const registry = createMachineLiveStreamCaptureRegistry();
        for (const sourceId of ['view-a', 'view-b']) {
            registry.register({
                sourceId,
                streamFamily: 'browser.streamed',
                adapter: unavailableMachineLiveStreamCaptureAdapter,
                capabilities: {
                    v: 1, sourceId, sourceKind: 'browser', supportedCodecs: ['image.mjpeg'],
                    maxFramesPerSecond: 12, inputMode: 'shared', sidebands: [], health: { status: 'available' },
                },
            });
        }
        expect(registry.resolve({ streamFamily: 'browser.streamed' })).toMatchObject({ ok: false });
        expect(registry.resolve({ sourceId: 'view-b', streamFamily: 'browser.streamed' })).toMatchObject({
            ok: true, source: { sourceId: 'view-b' },
        });
        expect(registry.resolve({ sourceId: 'view-b', streamFamily: 'screen' })).toMatchObject({ ok: false });
        registry.unregister('view-b');
        expect(registry.resolve({ sourceId: 'view-b', streamFamily: 'browser.streamed' })).toMatchObject({ ok: false });
    });
    it('resolves a registered source by id and exposes typed unavailable diagnostics for missing sources', async () => {
        const mod = await import('./captureRegistry').catch((error: unknown) => ({ importError: error }));

        expect(mod).toHaveProperty('createMachineLiveStreamCaptureRegistry');
        if (!('createMachineLiveStreamCaptureRegistry' in mod)) return;

        const registry = mod.createMachineLiveStreamCaptureRegistry();
        registry.register({
            sourceId: 'source_1',
            streamFamily: 'screen',
            adapter: unavailableMachineLiveStreamCaptureAdapter,
            capabilities: {
                v: 1,
                sourceId: 'source_1',
                sourceKind: 'screen',
                supportedCodecs: ['image.mjpeg'],
                maxFramesPerSecond: 12,
                inputMode: 'exclusive',
                sidebands: ['capture_health'],
                health: { status: 'available' },
            },
        });

        expect(registry.resolve({ sourceId: 'source_1' })).toMatchObject({
            ok: true,
            source: { sourceId: 'source_1' },
        });
        expect(registry.resolve({ sourceId: 'missing' })).toEqual({
            ok: false,
            diagnostic: {
                v: 1,
                sourceId: 'missing',
                reasonCode: 'capture_source_unavailable',
            },
        });
    });
});

import { describe, expect, it } from 'vitest';
import type { DaemonPluginStoredImageReadResponse, SessionImageMediaReferenceV1 } from '@happier-dev/protocol';
import { PluginUiSurfaceContextV1Schema, type PluginUiHostApiRequestEnvelopeV1, type PluginUiJsonValueV1 } from '@happier-dev/protocol/plugins/ui';
import { createPluginSurfaceStoredImageOwner } from './pluginSurfaceStoredImage';

const media: SessionImageMediaReferenceV1 = {
    mediaId: 'image-1', mediaKind: 'image', width: 100, height: 60, sizeBytes: 24,
    file: { sessionId: 'session-1', storage: 'daemon', path: '.happier/uploads/artifacts/session-1/image.png',
        sha256: 'a'.repeat(64), mimeType: 'image/png' },
};
function request(sessionId = 'session-1', mediaId = 'image-1'): PluginUiHostApiRequestEnvelopeV1 {
    return { version: 1, requestId: 'read-1', surface: PluginUiSurfaceContextV1Schema.parse({
        pluginId: 'acme.capture', contributionId: 'viewer', surfaceId: 'surface-1', placement: 'appSurface',
        platform: 'web', channel: 'internal', resourceScope: [], diagnostics: [],
    }), method: 'readStoredImage',
        payload: { image: { sessionId, mediaId } } };
}
const image = { bytesBase64: 'cG5n', mimeType: 'image/png' as const, width: 100, height: 60 };

describe('mounted stored image authority', () => {
    it.each([
        ['browser.context.attachToComposer', { structuredBlock: { screenshot: { media: [media] } } }],
        ['browser.context.attachToAgentTurn', { structuredBlock: { screenshot: { media: [media] } } }],
        ['browser.automation.snapshot', { resultSummary: { status: 'captured', snapshot: { media } } }],
        ['browser.automation.semanticSnapshot', { resultSummary: { status: 'captured', snapshot: { media } } }],
    ] satisfies readonly (readonly [string, PluginUiJsonValueV1])[])(
        'retains the exact native image returned by trusted %s without a prior capture in this mount',
        async (_actionId, result) => {
            const received: unknown[] = [];
            const owner = createPluginSurfaceStoredImageOwner({ pluginId: 'acme.capture', occurrenceId: 'occ-1',
                machineId: 'machine-1', serverId: 'server-1', isCurrent: () => true, lifetimeSignal: new AbortController().signal,
                // Only daemon transport is substituted; nested result admission and mount custody are real.
                read: async (_machineId, input) => { received.push(input); return { ok: true, image }; } });
            owner.retainActionResult(result);
            expect(await owner.readStoredImage(request())).toEqual(image);
            expect(received).toEqual([{ callerPluginId: 'acme.capture', expectedCallerOccurrenceId: 'occ-1', media }]);
        },
    );

    it('retains exact delivered Session images and refuses a foreign Session/media before transport', async () => {
        const received: unknown[] = [];
        const owner = createPluginSurfaceStoredImageOwner({ pluginId: 'acme.capture', occurrenceId: 'occ-1',
            machineId: 'machine-1', serverId: 'server-1', isCurrent: () => true, lifetimeSignal: new AbortController().signal,
            // The daemon transport is the substituted network boundary; custody logic remains real.
            read: async (_machineId, input) => { received.push(input); return { ok: true, image }; } });
        expect(await owner.readStoredImage(request())).toMatchObject({ code: 'unavailable' });
        owner.retainActionResult({ items: [{ raw: { image: media } }] });
        expect(await owner.readStoredImage(request('foreign-session'))).toMatchObject({ code: 'unavailable' });
        expect(await owner.readStoredImage(request('session-1', 'foreign-media'))).toMatchObject({ code: 'unavailable' });
        expect(received).toEqual([]);
        expect(await owner.readStoredImage(request())).toEqual(image);
        expect(received).toEqual([{ callerPluginId: 'acme.capture', expectedCallerOccurrenceId: 'occ-1', media }]);
        const foreignSurface = createPluginSurfaceStoredImageOwner({ pluginId: 'acme.capture', occurrenceId: 'occ-1',
            machineId: 'machine-1', serverId: 'server-1', isCurrent: () => true, lifetimeSignal: new AbortController().signal,
            read: async (_machineId, input) => { received.push(input); return { ok: true, image }; } });
        const foreignPlugin = createPluginSurfaceStoredImageOwner({ pluginId: 'other.capture', occurrenceId: 'occ-2',
            machineId: 'machine-1', serverId: 'server-1', isCurrent: () => true, lifetimeSignal: new AbortController().signal,
            read: async (_machineId, input) => { received.push(input); return { ok: true, image }; } });
        expect(await foreignSurface.readStoredImage(request())).toMatchObject({ code: 'unavailable' });
        expect(await foreignPlugin.readStoredImage(request())).toMatchObject({ code: 'unavailable' });
        expect(received).toHaveLength(1);
    });

    it('fences an in-flight disclosure when the mount retires', async () => {
        let finish: ((result: DaemonPluginStoredImageReadResponse) => void) | undefined;
        const lifetime = new AbortController();
        const owner = createPluginSurfaceStoredImageOwner({ pluginId: 'acme.capture', occurrenceId: 'occ-1',
            machineId: 'machine-1', serverId: null, isCurrent: () => true, lifetimeSignal: lifetime.signal,
            read: () => new Promise((resolve) => { finish = resolve; }) });
        owner.retainActionResult({ image: media });
        const pending = owner.readStoredImage(request());
        owner.dispose();
        finish?.({ ok: true, image });
        expect(await pending).toMatchObject({ code: 'stale_surface' });
        expect(await owner.readStoredImage(request())).toMatchObject({ code: 'stale_surface' });
    });
});

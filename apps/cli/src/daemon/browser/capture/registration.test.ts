import { describe, expect, it, vi } from 'vitest';
import { browserViewKey, BrowserEventBatchV1Schema, type MachineLiveStreamRelayEnvelopeV1 } from '@happier-dev/protocol';
import { createBrowserSidecarCdpControlAdapter, type BrowserSidecarCdpEventSubscriber } from '../sidecar/controlAdapter';
import { createBrowserAutomationDaemonService } from '../automation/service';
import { createBrowserAutomationCdpAdapter } from '../automation/adapters/cdp';
import { createControlAdapterAutomationTransport } from '../automation/adapters/controlBridge';
import { createMachineLiveStreamCaptureRegistry } from '../../peer/mediation/stream/captureRegistry';
import { createMachineLiveStreamRelayTerminator } from '../../peer/mediation/stream/relay';
import { createBrowserCdpScreencastProducer } from './cdpScreencast';
import { registerBrowserLiveCapture } from './registration';

describe('browser live capture', () => {
    it('streams the exact owned view and routes viewer input through human takeover without a simulator lease', async () => {
        const listeners = new Set<BrowserSidecarCdpEventSubscriber>();
        const commands: Array<{ method: string; params?: Record<string, unknown> }> = [];
        let failInput = false;
        // Chromium/CDP is the system boundary; capture, registry, codec/credit admission and
        // automation/controller arbitration below it are real owners.
        const transport = {
            openPage: async () => ({ targetId: 'page', sessionId: 'cdp-page' }),
            dispatchPageCommand: async (command: (typeof commands)[number]) => {
                commands.push(command);
                if (failInput && command.method === 'Input.insertText') throw new Error('native input failed');
                return {};
            },
            dispatchBrowserCommand: async () => ({}),
            subscribeCdpEvents: (listener: BrowserSidecarCdpEventSubscriber) => {
                listeners.add(listener); return () => { listeners.delete(listener); };
            },
        };
        const adapter = createBrowserSidecarCdpControlAdapter({ browserSessionId: 'browser', sidecarId: 'sidecar', transport });
        const contextCapture = { transport, resolvePageHandle: adapter.resolvePageHandle,
            subscribeCdpEvents: transport.subscribeCdpEvents, subscribeViewLifecycle: adapter.subscribeViewLifecycle,
            subscribeBrowserEvents: adapter.subscribeBrowserEvents, getNavigationState: adapter.getNavigationState };
        const automation = createBrowserAutomationDaemonService({ adapter: createBrowserAutomationCdpAdapter({
            transport: createControlAdapterAutomationTransport({ adapter, contextCapture }),
        }) });
        const producer = createBrowserCdpScreencastProducer({ contextCapture });
        const registry = createMachineLiveStreamCaptureRegistry();
        const registration = registerBrowserLiveCapture({ registry, contextCapture, producer, automation: () => automation });
        const view = { browserSessionId: 'browser', viewId: 'view' };
        const sourceId = browserViewKey(view);
        const envelopes: MachineLiveStreamRelayEnvelopeV1[] = [];
        const browserEvents = () => envelopes.flatMap(envelope => envelope.message.kind === 'frame'
            && envelope.message.frame.payloadKind === 'metadata'
            ? BrowserEventBatchV1Schema.parse(JSON.parse(Buffer.from(envelope.message.frame.payloadBase64, 'base64').toString('utf8'))).events : []);
        const relay = createMachineLiveStreamRelayTerminator({ registry, machineId: 'machine', nowMs: Date.now,
            emitEnvelope: envelope => {
                envelopes.push(envelope);
                if (envelope.message.kind === 'frame') relay.applyControl({ v: 1, sourceMachineId: 'machine', targetMachineId: 'viewer',
                    message: { kind: 'control', control: { v: 1, streamId: 'stream', kind: 'ack', nextSequence: envelope.message.frame.sequence + 1 } } });
            } });
        try {
            await adapter.dispatchCommand({ kind: 'openView', commandId: 'open', focus: true, ...view, platform: 'web',
                target: { kind: 'externalUrl', targetId: 'external', url: 'https://example.test/' } });
            const source = registry.resolve({ sourceId, streamFamily: 'browser.streamed' });
            expect(source.ok).toBe(true);
            if (!source.ok) return;
            const start = { v: 1 as const, streamId: 'stream', streamFamily: 'browser.streamed', sourceId,
                sourceMachineId: 'machine', targetMachineId: 'viewer', routeKind: 'server_relay' as const,
                authorization: { payload: { v: 1 as const, grantId: 'grant', accountId: 'account', flowKind: 'live_stream' as const,
                    routeKind: 'server_relay' as const, sourceMachineId: 'machine', targetMachineId: 'viewer',
                    streamId: 'stream', streamFamily: 'browser.streamed', sourceId, iat: Date.now(), exp: Date.now() + 60_000,
                    aud: 'happier-live-stream-relay-authorization' as const },
                    signature: { keyId: 'key', alg: 'Ed25519' as const, valueBase64Url: 'AQID' } } };
            // Signature authentication belongs to server ingress. This test exercises the actual
            // daemon terminator, registry, frame pump and controller under its admitted contract.
            expect(await relay.start(start)).toEqual({ ok: true, streamId: 'stream' });
            for (const listener of [...listeners]) listener({ method: 'Page.screencastFrame', sessionId: 'cdp-page',
                params: { sessionId: 1, data: 'AQID', metadata: { deviceWidth: 400, deviceHeight: 200 } } });
            expect(envelopes.filter(envelope => envelope.message.kind === 'frame' && envelope.message.frame.payloadKind !== 'metadata')).toMatchObject([
                { message: { frame: { streamId: 'stream', sequence: expect.any(Number), payloadBase64: 'AQID', codecId: 'image.mjpeg' } } },
            ]);
            expect(browserEvents()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'controllerChanged', state: expect.objectContaining({ controller: 'none' }) })]));
            for (const listener of [...listeners]) listener({ method: 'Page.frameNavigated', sessionId: 'cdp-page',
                params: { frame: { id: 'main', loaderId: 'next-document', url: 'https://example.test/next' } } });
            expect(browserEvents()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'navigationStateChanged', currentUrl: 'https://example.test/next', navigationGeneration: 1 })]));
            expect(relay.applyControl({ v: 1, sourceMachineId: 'machine', targetMachineId: 'viewer', message: {
                kind: 'sideband_control', control: { v: 1, streamId: 'stream', sourceId, eventId: 'click', kind: 'tap', x: 0.5, y: 0.5 },
            } })).toEqual({ ok: true });
            await vi.waitFor(() => expect(automation.getTimeline(view).entries.map(({ status, reasonCode }) => ({ status, reasonCode })))
                .toEqual([{ status: 'succeeded', reasonCode: undefined }]));
            await vi.waitFor(() => expect(commands).toEqual(expect.arrayContaining([
                expect.objectContaining({ method: 'Input.dispatchMouseEvent', params: expect.objectContaining({ type: 'mousePressed', x: 200, y: 100 }) }),
            ])));
            expect(automation.getStatus(view).controller).toBe('human');
            expect(browserEvents()).toEqual(expect.arrayContaining([
                expect.objectContaining({ kind: 'controllerChanged', ...view, state: expect.objectContaining({ controller: 'human', controlEpoch: 1 }) }),
            ]));
            for (const control of [
                { v: 1 as const, streamId: 'stream', sourceId, eventId: 'type', kind: 'keyboard_text' as const, text: 'hello' },
                { v: 1 as const, streamId: 'stream', sourceId, eventId: 'scroll', kind: 'swipe' as const,
                    fromX: 0.5, fromY: 0.75, toX: 0.5, toY: 0.25, durationMs: 100 },
            ]) {
                expect(relay.applyControl({ v: 1, sourceMachineId: 'machine', targetMachineId: 'viewer',
                    message: { kind: 'sideband_control', control } })).toEqual({ ok: true });
            }
            await vi.waitFor(() => expect(automation.getTimeline(view).entries.map(entry => entry.status))
                .toEqual(['succeeded', 'succeeded', 'succeeded']));
            expect(commands).toEqual(expect.arrayContaining([
                expect.objectContaining({ method: 'Input.insertText', params: { text: 'hello' } }),
                expect.objectContaining({ method: 'Input.dispatchMouseEvent', params: {
                    type: 'mouseWheel', x: 200, y: 150, deltaX: 0, deltaY: 100,
                } }),
            ]));
            expect(relay.applyControl({ v: 1, sourceMachineId: 'machine', targetMachineId: 'viewer', message: {
                kind: 'sideband_control', control: { v: 1, streamId: 'stream', sourceId: 'another-view', eventId: 'wrong', kind: 'keyboard_text', text: 'secret' },
            } })).toEqual({ ok: false, reasonCode: 'input_lease_mismatch' });
            failInput = true;
            expect(relay.applyControl({ v: 1, sourceMachineId: 'machine', targetMachineId: 'viewer', message: {
                kind: 'sideband_control', control: { v: 1, streamId: 'stream', sourceId, eventId: 'failed-input', kind: 'keyboard_text', text: 'hello' },
            } })).toEqual({ ok: true });
            await vi.waitFor(() => expect(envelopes).toEqual(expect.arrayContaining([
                expect.objectContaining({ message: expect.objectContaining({ kind: 'receipt', receipt: expect.objectContaining({ terminal: false }) }) }),
            ])));
            for (const listener of [...listeners]) listener({ method: 'Page.screencastFrame', sessionId: 'cdp-page',
                params: { sessionId: 2, data: 'BAUG', metadata: { deviceWidth: 400, deviceHeight: 200 } } });
            expect(envelopes).toEqual(expect.arrayContaining([
                expect.objectContaining({ message: expect.objectContaining({ kind: 'frame', frame: expect.objectContaining({ payloadBase64: 'BAUG' }) }) }),
            ]));
            await adapter.dispatchCommand({ kind: 'closeView', commandId: 'close', ...view });
            expect(browserEvents()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'viewClosed', ...view })]));
            expect(registry.resolve({ sourceId }).ok).toBe(false);
            await relay.stop('stream');
        } finally {
            await relay.dispose(); registration.dispose(); await producer.dispose(); automation.dispose(); adapter.dispose();
        }
    });
});

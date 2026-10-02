import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderHook } from '@/dev/testkit';
import { buildBrowserAdapterCapabilities } from '@/sync/domains/browser/adapters/capabilities';
import type { BrowserControlViewState } from '@/sync/domains/browser/control';
import type { MachineLiveStreamRelayEnvelopeV1 } from '@happier-dev/protocol';
import { encodeBase64 } from '@/encryption/base64';
import { applyBrowserControlEvent, createBrowserControlState } from '@/sync/domains/browser/control';

// Network boundaries only: the machine RPC transport (daemon discovery) and the viewer relay socket.
const boundary = vi.hoisted(() => ({
    views: [] as unknown[],
    sent: [] as unknown[],
    listeners: new Set<(raw: unknown) => void>(),
    requests: [] as unknown[],
    disconnect: vi.fn(async () => undefined),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: async (input: { method: string }) => {
        boundary.requests.push(input);
        if (input.method === 'daemon.browser.view.list') return { protocolVersion: 1, views: boundary.views };
        throw new Error('offline');
    },
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineLiveStreamRelaySocket', () => ({
    resolveServerScopedMachineLiveStreamRelaySocket: async () => ({
        machineId: 'machine_1',
        viewerId: 'viewer_1',
        socketId: 'tab_1',
        sendEnvelope: (envelope: unknown) => { boundary.sent.push(envelope); },
        onEnvelope: (listener: (raw: unknown) => void) => {
            boundary.listeners.add(listener); return () => { boundary.listeners.delete(listener); };
        },
        disconnect: boundary.disconnect,
    }),
}));

const view = {
    browserSessionId: 'browser_session_1',
    viewId: 'view_1',
    target: { kind: 'externalUrl', targetId: 't', url: 'http://localhost:5173/login' },
    platform: 'web',
    adapterKind: 'chromiumSidecar',
    engineKind: 'streamedSurface',
    adapterCapabilities: buildBrowserAdapterCapabilities({
        adapterKind: 'chromiumSidecar', supportedTargetKinds: ['externalUrl'], supportedRenderEngines: ['streamedSurface'],
    }),
    currentUrl: 'http://localhost:5173/login', currentUrlExpiresAt: null, pendingUrl: null, title: null, faviconUrl: null,
    loadingState: 'idle', loadingProgress: null, navigationGeneration: 0, canGoBack: false, canGoForward: false,
    securityOrigin: null, lastError: null, openerViewId: null, adapterRefreshStatus: 'idle', adapterRefreshError: null,
} as unknown as BrowserControlViewState;

function daemonView(captureSource?: Record<string, unknown>) {
    return {
        browserSessionId: 'browser_session_1',
        viewId: 'view_1',
        sourceId: 'browser-view-key-1',
        target: view.target,
        platform: 'web',
        adapterKind: 'chromiumSidecar',
        events: [],
        ...(captureSource ? { captureSource } : {}),
    };
}

describe('useBrowserStreamedSurfaceRuntime', () => {
    beforeEach(() => {
        boundary.views = [];
        boundary.sent = [];
        boundary.listeners.clear();
        boundary.requests = [];
        boundary.disconnect.mockClear();
    });

    it('discovers and admits the session daemon view before any view is seeded in the host', async () => {
        boundary.views = [daemonView({ v: 1, sourceId: 'browser-view-key-1', sourceKind: 'browser',
            supportedCodecs: ['image.mjpeg'], inputMode: 'shared', sidebands: [], health: { status: 'available' } })];
        const { useBrowserStreamedSurfaceRuntime } = await import('./useBrowserStreamedSurfaceRuntime');
        let state = createBrowserControlState();
        await renderHook(() => useBrowserStreamedSurfaceRuntime({ view: null, machineId: 'machine_1', serverId: 'server_1',
            browserSessionId: 'browser_session_1',
            onBrowserEvent: event => { state = applyBrowserControlEvent(state, event); } }));
        await flushHookEffects({ cycles: 6, turns: 6 });
        expect(state.viewsById.view_1).toMatchObject({ browserSessionId: 'browser_session_1',
            target: { kind: 'streamedBrowser', streamId: 'browser-view-key-1' }, engineKind: 'streamedSurface',
            adapterCapabilities: { supportsStreamingDisplay: true, navigation: { canNavigate: true } } });
        expect(boundary.requests).toContainEqual(expect.objectContaining({
            payload: { machineId: 'machine_1', browserSessionId: 'browser_session_1' },
        }));
    });

    it('reports the agent\'s browser unavailable when the daemon has no capture source for the view (never guessed)', async () => {
        boundary.views = [daemonView()];
        const { useBrowserStreamedSurfaceRuntime } = await import('./useBrowserStreamedSurfaceRuntime');
        const hook = await renderHook(() => useBrowserStreamedSurfaceRuntime({ view, machineId: 'machine_1', serverId: 'server_1' }));
        await flushHookEffects({ cycles: 4, turns: 4 });
        expect(hook.getCurrent()).toMatchObject({ connecting: false, playerState: null, input: null });
    });

    it('opens the exact discovered source and routes viewer input back to it as sideband controls', async () => {
        boundary.views = [daemonView({
            v: 1, sourceId: 'browser-view-key-1', sourceKind: 'browser', supportedCodecs: ['image.mjpeg'],
            inputMode: 'shared', sidebands: [], health: { status: 'available' },
        })];
        const { useBrowserStreamedSurfaceRuntime } = await import('./useBrowserStreamedSurfaceRuntime');
        const hook = await renderHook(() => useBrowserStreamedSurfaceRuntime({ view, machineId: 'machine_1', serverId: 'server_1' }));
        await flushHookEffects({ cycles: 6, turns: 6 });

        const input = hook.getCurrent()?.input;
        expect(input).toMatchObject({ sourceId: 'browser-view-key-1' });
        expect(input?.streamId).toContain('browser-view-key-1');
        await act(async () => {
            input?.send({ v: 1, streamId: input.streamId, sourceId: input.sourceId, eventId: 'e1', kind: 'tap', x: 0.5, y: 0.5 });
        });
        expect(boundary.sent).toContainEqual(expect.objectContaining({
            sourceMachineId: 'machine_1',
            viewerSocketId: 'tab_1',
            message: { kind: 'sideband_control', control: expect.objectContaining({ kind: 'tap', sourceId: 'browser-view-key-1' }) },
        }));
    });

    it('ingests exact-view controller and closed metadata through one socket subscriber without decoding it as pixels', async () => {
        boundary.views = [daemonView({ v: 1, sourceId: 'browser-view-key-1', sourceKind: 'browser',
            supportedCodecs: ['image.mjpeg'], inputMode: 'shared', sidebands: [], health: { status: 'available' } })];
        const { useBrowserStreamedSurfaceRuntime } = await import('./useBrowserStreamedSurfaceRuntime');
        let state = { ...createBrowserControlState(), viewsById: { [view.viewId]: view } };
        const hook = await renderHook(() => useBrowserStreamedSurfaceRuntime({ view, machineId: 'machine_1', serverId: 'server_1',
            onBrowserEvent: event => { state = applyBrowserControlEvent(state, event); } }));
        await flushHookEffects({ cycles: 6, turns: 6 });
        const streamId = hook.getCurrent()?.input?.streamId;
        expect(streamId).toBeTruthy();
        if (!streamId) return;
        expect(boundary.listeners.size).toBe(1); // Required single-subscription contract, not a wiring count.
        const before = hook.getCurrent()?.playerState;
        const controller = { kind: 'controllerChanged', eventId: 'human', occurredAt: 1, browserSessionId: view.browserSessionId,
            viewId: view.viewId, navigationGeneration: 0,
            state: { browserSessionId: view.browserSessionId, viewId: view.viewId, controller: 'human', controlEpoch: 3 } };
        const metadata = (events: readonly unknown[], targetStreamId = streamId): MachineLiveStreamRelayEnvelopeV1 => {
            const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, events }));
            return { v: 1, sourceMachineId: 'machine_1', targetMachineId: 'machine_1', message: { kind: 'frame', frame: {
                v: 1, streamId: targetStreamId, sequence: 1, timestampMs: 1, codecId: 'image.mjpeg', payloadKind: 'metadata',
                payloadEncoding: 'binary_base64', payloadBase64: encodeBase64(bytes), payloadSizeBytes: bytes.byteLength,
            } } };
        };
        await act(async () => { for (const listener of boundary.listeners) listener(metadata([controller], 'foreign-stream')); });
        expect(state.viewsById[view.viewId].automationController).toBeUndefined();
        await act(async () => { for (const listener of boundary.listeners) listener(metadata([controller])); });
        expect(state.viewsById[view.viewId].automationController).toMatchObject({ controller: 'human', controlEpoch: 3 });
        expect(hook.getCurrent()?.playerState).toBe(before);
        await act(async () => { for (const listener of boundary.listeners) listener(metadata([{ kind: 'viewClosed', eventId: 'close', occurredAt: 2,
            browserSessionId: view.browserSessionId, viewId: view.viewId }])); });
        expect(state.viewsById[view.viewId]).toBeUndefined();
        await hook.unmount();
        expect(boundary.listeners.size).toBe(0);
    });

    it('does nothing for views the app renders itself', async () => {
        const { useBrowserStreamedSurfaceRuntime } = await import('./useBrowserStreamedSurfaceRuntime');
        const hook = await renderHook(() => useBrowserStreamedSurfaceRuntime({
            view: { ...view, adapterKind: 'externalUrl', engineKind: 'webIframe' } as BrowserControlViewState,
            machineId: 'machine_1',
            serverId: 'server_1',
        }));
        expect(hook.getCurrent()).toBeNull();
    });

    it('pauses hidden stream subscriptions while retaining the discovered source and socket across show/hide/show', async () => {
        boundary.views = [daemonView({ v: 1, sourceId: 'browser-view-key-1', sourceKind: 'browser',
            supportedCodecs: ['image.mjpeg'], inputMode: 'shared', sidebands: [], health: { status: 'available' } })];
        const { useBrowserStreamedSurfaceRuntime } = await import('./useBrowserStreamedSurfaceRuntime');
        const hook = await renderHook((enabled: boolean) => useBrowserStreamedSurfaceRuntime({
            view, machineId: 'machine_1', serverId: 'server_1', enabled,
        }), { initialProps: true });
        await flushHookEffects({ cycles: 6, turns: 6 });
        const input = hook.getCurrent()?.input;
        const playerState = hook.getCurrent()?.playerState;
        expect(input?.sourceId).toBe('browser-view-key-1');
        expect(boundary.listeners.size).toBe(1);

        await hook.rerender(false);
        expect(boundary.listeners.size).toBe(0);
        expect(boundary.disconnect).not.toHaveBeenCalled();
        expect(hook.getCurrent()?.input).toBe(input);
        expect(hook.getCurrent()?.playerState).toBe(playerState);

        await hook.rerender(true);
        await flushHookEffects({ cycles: 6, turns: 6 });
        expect(boundary.listeners.size).toBe(1);
        expect(hook.getCurrent()?.input?.streamId).toBe(input?.streamId);
        expect(boundary.disconnect).not.toHaveBeenCalled();
        await hook.unmount();
        expect(boundary.listeners.size).toBe(0);
    });
});

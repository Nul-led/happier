import { browserViewKey } from '@happier-dev/protocol';
import { describe, expect, it } from 'vitest';
import { createBrowserSidecarCdpControlAdapter } from '../sidecar/controlAdapter';
import { createBrowserDaemonControlBroker } from './broker';
import { createBrowserDaemonControlRoutes } from './routes';
import { registerDaemonBrowserControlHandler } from '../../../rpc/handlers/daemonBrowserControl';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { RpcHandler } from '../../../api/rpc/types';
import { createMachineLiveStreamCaptureRegistry } from '../../peer/mediation/stream/captureRegistry';
import { createBrowserCdpScreencastProducer } from '../capture/cdpScreencast';
import { registerBrowserLiveCapture } from '../capture/registration';

describe('daemon browser view discovery', () => {
  it('projects only the requested session from the live control owner and removes closed views', async () => {
    const broker = createBrowserDaemonControlBroker();
    const transport = {
      openPage: async () => ({ targetId: 'private-cdp-target', sessionId: 'private-cdp-session' }),
      dispatchPageCommand: async () => ({}), dispatchBrowserCommand: async () => ({}),
      subscribeCdpEvents: () => () => {},
    };
    const adapter = createBrowserSidecarCdpControlAdapter({ browserSessionId: 'session', sidecarId: 'sidecar', transport });
    const contextCapture = { transport, resolvePageHandle: adapter.resolvePageHandle,
      subscribeCdpEvents: transport.subscribeCdpEvents, subscribeViewLifecycle: adapter.subscribeViewLifecycle };
    const registry = createMachineLiveStreamCaptureRegistry();
    const producer = createBrowserCdpScreencastProducer({ contextCapture });
    const registration = registerBrowserLiveCapture({ registry, producer, contextCapture, automation: () => null });
    broker.registerAdapter(adapter);
    const routes = createBrowserDaemonControlRoutes({ broker, captureRegistry: registry });
    const discover = () => routes.listViews('session');
    const handlers = new Map<string, RpcHandler>();
    registerDaemonBrowserControlHandler({ registerHandler: (method, handler) => { handlers.set(method, handler); } }, { browserControl: routes });
    try {
      const view = { browserSessionId: 'session', viewId: 'view' };
      const target = { kind: 'externalUrl' as const, targetId: 'external', url: 'https://example.test/' };
      await routes.dispatchCommand({ kind: 'openView', commandId: 'open', ...view, target, platform: 'web' });
      expect(discover()).toMatchObject([{ ...view, sourceId: browserViewKey(view), target,
        adapterKind: 'chromiumSidecar', events: [expect.objectContaining({ kind: 'navigationStateChanged' })],
        captureSource: { sourceId: browserViewKey(view), sourceKind: 'browser', supportedCodecs: ['image.mjpeg'] } }]);
      expect(routes.listViews('other-session')).toEqual([]);
      const rpcDiscover = handlers.get(RPC_METHODS.DAEMON_BROWSER_VIEW_LIST);
      expect(await rpcDiscover?.({ machineId: 'machine', browserSessionId: 'session' })).toMatchObject({
        protocolVersion: 1, views: [{ ...view, sourceId: browserViewKey(view) }],
      });
      expect(JSON.stringify(discover())).not.toContain('private-cdp');
      registry.unregister(browserViewKey(view));
      expect(discover()[0]?.captureSource).toBeUndefined();
      await routes.dispatchCommand({ kind: 'closeView', commandId: 'close', ...view });
      expect(discover()).toEqual([]);
    } finally { registration.dispose(); await producer.dispose(); adapter.dispose(); }
  });
});

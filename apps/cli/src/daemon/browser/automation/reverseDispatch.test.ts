import { describe, expect, it, vi } from 'vitest';
import {
  UiBrowserAutomationDispatchRequestV1Schema,
  UiBrowserAutomationDispatchResultV1Schema,
  uiBrowserAutomationDispatchMethod,
  type RuntimeActionExecuteArgs,
} from '@happier-dev/protocol';

import { createBrowserDaemonRuntimeActionExecutor } from '../actions/runtimeActionExecutor';
import { createBrowserSidecarCdpControlAdapter } from '../sidecar/controlAdapter';
import { createBrowserDaemonControlBroker } from '../control/broker';
import { createBrowserAutomationReverseDispatcher } from './reverseDispatch';

const view = { browserSessionId: 'visible-session', viewId: 'visible-view' };
const request = { v: 1, ...view, automationRequestId: 'click-1', actionKind: 'click', navigationGeneration: 0,
  requestedBy: 'agent', requesterRef: { kind: 'agent', id: 'agent-1' }, timeoutMs: 1000, payload: { selector: '#button' } } as const;
const args: RuntimeActionExecuteArgs = { actionId: 'browser.automation.click', input: request,
  context: { surface: 'agent', authority: 'account_automation', defaultSessionId: 'happier-session' } };

describe('daemon browser reverse dispatch protocol boundary', () => {
  it('dispatches to the exact UI RPC and forwards present-user cancellation authority without provisioning', async () => {
    const wireRequests: unknown[] = [];
    // Connected-client RPC is the network boundary. UI behavior is exercised by its own package.
    const uiAutomation = createBrowserAutomationReverseDispatcher({ getMachineClient: () => ({
      hasConnectedClientRpcHandler: method => method === uiBrowserAutomationDispatchMethod(view),
      callConnectedClientRpc: async (_method, payload) => {
        const wire = UiBrowserAutomationDispatchRequestV1Schema.parse(payload);
        wireRequests.push(wire);
        const result = wire.actionId === 'browser.automation.cancelActive'
          ? { v: 1, outcome: 'canceled', canceledCount: 1, completion: 'uncertain' }
          : { v: 1, automationRequestId: request.automationRequestId, durationMs: 0,
              navigationGenerationBefore: 0, navigationGenerationAfter: 0, controlEpochBefore: 0, controlEpochAfter: 0,
              status: 'succeeded', adapterKind: 'localPreview', fidelity: 'injectedPage',
              trustedInput: false, resultSummary: { clicked: true } };
        return { ok: true, result: UiBrowserAutomationDispatchResultV1Schema.parse(result) };
      },
    }) });
    const provisionAutomationRuntime = vi.fn(async () => 'provisioning' as const);
    const execute = createBrowserDaemonRuntimeActionExecutor({
      featureGate: { isEnabled: () => true, refresh: async () => {} }, ownsAutomationView: () => false,
      provisionAutomationRuntime, uiAutomation,
    });
    expect(await execute(args)).toMatchObject({ status: 'succeeded', resultSummary: { clicked: true } });
    expect(await execute({ actionId: 'browser.automation.cancelActive', input: view,
      context: { surface: 'agent', authority: 'present_user' } }))
      .toEqual({ v: 1, outcome: 'canceled', canceledCount: 1, completion: 'uncertain' });
    expect(wireRequests).toEqual([
      { v: 1, actionId: args.actionId, input: request, authority: 'account_automation' },
      { v: 1, actionId: 'browser.automation.cancelActive', input: view, authority: 'present_user' },
    ]);
    expect(provisionAutomationRuntime).not.toHaveBeenCalled();
  });

  it('provisions only a view actually owned by the registered daemon broker adapter', async () => {
    const adapter = createBrowserSidecarCdpControlAdapter({ browserSessionId: 'daemon-session', sidecarId: 'sidecar', transport: {
      openPage: async () => ({ targetId: 'target' }), dispatchPageCommand: async () => ({}), dispatchBrowserCommand: async () => ({}),
    } });
    const broker = createBrowserDaemonControlBroker();
    broker.registerAdapter(adapter);
    const daemonView = { browserSessionId: 'daemon-session', viewId: 'daemon-view' };
    try {
      expect(await broker.dispatchCommand({ kind: 'openView', commandId: 'open', ...daemonView, platform: 'desktop', focus: true,
        target: { kind: 'externalUrl', targetId: 'page', url: 'https://example.test/' } })).toMatchObject({ status: 'dispatched' });
      const provisionAutomationRuntime = vi.fn(async () => 'provisioning' as const);
      const execute = createBrowserDaemonRuntimeActionExecutor({ featureGate: { isEnabled: () => true, refresh: async () => {} },
        ownsAutomationView: broker.ownsView, provisionAutomationRuntime });
      expect(await execute({ ...args, input: { ...request, ...daemonView }, context: { ...args.context, defaultSessionId: daemonView.browserSessionId } }))
        .toMatchObject({ error: 'runtime_action_disabled:browser:browser_automation_runtime_provisioning' });
      expect(await execute({ ...args, input: { ...request, ...daemonView } })).toMatchObject({ errorCode: 'invalid_parameters' });
      expect(provisionAutomationRuntime).toHaveBeenCalledOnce();
      expect(await execute(args)).toMatchObject({ error: 'runtime_action_disabled:browser:browser_ui_automation_unavailable' });
      expect(provisionAutomationRuntime).toHaveBeenCalledOnce();
    } finally { adapter.dispose(); }
  });

  it('rejects disconnected UI targets without provisioning when no daemon route exists', async () => {
    const provisionAutomationRuntime = vi.fn(async () => 'provisioning' as const);
    const execute = createBrowserDaemonRuntimeActionExecutor({
      featureGate: { isEnabled: () => true, refresh: async () => {} }, ownsAutomationView: () => false, provisionAutomationRuntime,
      uiAutomation: createBrowserAutomationReverseDispatcher({ getMachineClient: () => null }),
    });
    expect(await execute(args)).toMatchObject({ ok: false, errorCode: 'runtime_action_disabled', error: 'runtime_action_disabled:browser:browser_ui_automation_unavailable' });
    expect(provisionAutomationRuntime).not.toHaveBeenCalled();
  });
});

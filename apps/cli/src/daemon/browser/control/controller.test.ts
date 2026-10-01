import { describe, expect, it } from 'vitest';
import { createBrowserAutomationDaemonService } from '../automation/service';
import { createBrowserSidecarCdpControlAdapter } from '../sidecar/controlAdapter';
import { createBrowserDaemonControlBroker } from './broker';
import { createBrowserDaemonControlRoutes } from './routes';
import { createBrowserAutomationCdpAdapter } from '../automation/adapters/cdp';
import { createCliActionExecutorHarness } from '@/session/actions/createCliActionExecutorHarness';
import { createDaemonRuntimeActionExecutor } from '../../runtimeActionExecutor';
import { ActionsSettingsV1Schema, FeaturesResponseSchema, type ApprovalRequest } from '@happier-dev/protocol';

describe('daemon browser controller commands', () => {
  it.each(['takeControl', 'handBack'] as const)('routes agent %s through Action approval and the existing controller', async kind => {
    const view = { browserSessionId: 'browser', viewId: 'view' };
    const adapter = createBrowserSidecarCdpControlAdapter({ browserSessionId: 'browser', sidecarId: 'sidecar', transport: {
      openPage: async () => ({ targetId: 'page', sessionId: 'cdp-page' }),
      dispatchPageCommand: async () => ({}), dispatchBrowserCommand: async () => ({}),
    } });
    const broker = createBrowserDaemonControlBroker();
    broker.registerAdapter(adapter);
    await broker.dispatchCommand({ ...view, kind: 'openView', commandId: 'open', focus: true, platform: 'web',
      target: { kind: 'externalUrl', targetId: 'target', url: 'https://example.test' } });
    const automation = createBrowserAutomationDaemonService({ adapter: createBrowserAutomationCdpAdapter({ transport: {
      ownsView: broker.ownsView, dispatchControlCommand: broker.dispatchCommand,
      dispatchPageQuery: async () => ({ ok: true }), dispatchInputCommand: async () => ({ ok: true }),
    } }) });
    const control = createBrowserDaemonControlRoutes({ broker, automation: () => automation });
    let decision: 'approve' | 'reject' = 'reject';
    let stored: ApprovalRequest | undefined;
    const harness = createCliActionExecutorHarness({ token: 'token', sessionId: 'browser', mode: 'plain', ctx: null }, {
      runtimeActionExecute: createDaemonRuntimeActionExecutor({ env: {}, resolveRouteOwners: () => ({ browserControl: control }),
        resolveServerFeaturesSnapshot: () => ({ status: 'ready', features: FeaturesResponseSchema.parse({ features: {
          browser: { enabled: true, viewTargets: { enabled: true }, internal: { enabled: true }, sidecar: { enabled: true } },
        } }) }) }),
      approvalsCreate: async ({ request }) => { stored = request; return { artifactId: 'control-approval' }; },
      approvalsGet: async () => null, approvalsUpdate: async () => ({ ok: true }),
      approvalsWaitForDecision: async ({ request }) => ({ decision, request }),
      isApprovalExecutionOriginCurrent: async () => true,
    });
    const context = { surface: 'agent' as const, authority: 'account_automation' as const, defaultSessionId: 'browser',
      serverId: 'home', actionRequestId: 'browser-control', actionsSettings: ActionsSettingsV1Schema.parse({ v: 1 }) };
    try {
      if (kind === 'handBack') await control.dispatchCommand({ ...view, kind: 'takeControl', commandId: 'take' }, { authority: 'present_user' });
      const before = automation.getStatus(view).controller;
      expect(await harness.executor.execute(`browser.control.${kind}`, { ...view, kind, commandId: 'control' }, context))
        .toMatchObject({ ok: false, errorCode: 'approval_rejected' });
      expect(automation.getStatus(view).controller).toBe(before);
      expect(stored).toMatchObject({ executionOriginV1: { authority: 'account_automation' } });
      decision = 'approve';
      const approved = await harness.executor.execute(`browser.control.${kind}`, { ...view, kind, commandId: 'control' }, context);
      expect(approved, JSON.stringify(approved)).toMatchObject({ ok: true, result: { status: 'dispatched' } });
      expect(automation.getStatus(view).controller).toBe(kind === 'takeControl' ? 'human' : 'none');
      if (kind === 'handBack') {
        const request = { ...view, v: 1 as const, automationRequestId: 'next', navigationGeneration: 0,
          requestedBy: 'agent' as const, requesterRef: { kind: 'agent', id: 'agent' }, timeoutMs: 5000,
          actionKind: 'click' as const, payload: { selector: '#go' } };
        expect(await automation.execute(request)).toMatchObject({ errorCode: 'stale_navigation' });
        await automation.execute({ ...request, actionKind: 'snapshot', payload: {} });
        expect(await automation.execute(request)).toMatchObject({ status: 'succeeded' });
      }
      await control.dispatchCommand({ ...view, kind: kind === 'takeControl' ? 'handBack' : 'takeControl',
        commandId: 'reset-for-waiver' }, { authority: 'present_user' });
      stored = undefined;
      expect(await harness.executor.execute(`browser.control.${kind}`, { ...view, kind, commandId: 'waived' }, {
        ...context,
        actionsSettings: ActionsSettingsV1Schema.parse({ v: 1,
          approvalWaivedSurfaces: { [`browser.control.${kind}`]: ['agent'] } }),
      })).toMatchObject({ ok: true, result: { status: 'dispatched' } });
      expect(stored).toBeUndefined();
      expect(automation.getStatus(view).controller).toBe(kind === 'takeControl' ? 'human' : 'none');
    } finally { automation.dispose(); adapter.dispose(); }
  });
  it('requires host authority and hands the held view back through the control owner', async () => {
    const view = { browserSessionId: 'browser', viewId: 'view' };
    // CDP is the system boundary. Broker, route and controller admission remain real.
    const adapter = createBrowserSidecarCdpControlAdapter({ browserSessionId: 'browser', sidecarId: 'sidecar', transport: {
      openPage: async () => ({ targetId: 'page', sessionId: 'cdp-page' }),
      dispatchPageCommand: async () => ({}), dispatchBrowserCommand: async () => ({}),
    } });
    const broker = createBrowserDaemonControlBroker();
    broker.registerAdapter(adapter);
    await broker.dispatchCommand({ kind: 'openView', commandId: 'open', focus: true, ...view, platform: 'web',
      target: { kind: 'externalUrl', targetId: 'target', url: 'https://example.test/' } });
    const automation = createBrowserAutomationDaemonService({ adapter: { adapterKind: 'chromiumSidecar',
      execute: async () => ({ status: 'succeeded', fidelity: 'cdp', trustedInput: true }) } });
    const routes = createBrowserDaemonControlRoutes({ broker, automation: () => automation });
    try {
      expect(await routes.dispatchCommand({ kind: 'takeControl', commandId: 'take', ...view })).toMatchObject({
        status: 'failed', error: { code: 'permission_denied' },
      });
      expect(await routes.dispatchCommand({ kind: 'takeControl', commandId: 'take', ...view }, { authority: 'present_user' }))
        .toMatchObject({ status: 'dispatched', events: [{ kind: 'controllerChanged', state: { controller: 'human', controlEpoch: 1 } }] });
      const request = { v: 1 as const, ...view, automationRequestId: 'action', navigationGeneration: 0,
        requestedBy: 'agent' as const, requesterRef: { kind: 'agent', id: 'agent' }, timeoutMs: 5_000,
        actionKind: 'click' as const, payload: { selector: '#go' } };
      expect(await automation.execute(request)).toMatchObject({ errorCode: 'human_interrupted' });
      expect(await routes.dispatchCommand({ kind: 'handBack', commandId: 'back', ...view }, { authority: 'present_user' }))
        .toMatchObject({ status: 'dispatched', events: [{ kind: 'controllerChanged', state: { controller: 'none' } }] });
      expect(await automation.execute(request)).toMatchObject({ errorCode: 'stale_navigation' });
      await automation.execute({ ...request, actionKind: 'snapshot', payload: {} });
      expect(await automation.execute(request)).toMatchObject({ status: 'succeeded' });
    } finally { automation.dispose(); adapter.dispose(); }
  });
});

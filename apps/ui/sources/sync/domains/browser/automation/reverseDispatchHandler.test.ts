import { afterEach, describe, expect, it, vi } from 'vitest';
import { UiBrowserAutomationDispatchRequestV1Schema, UiBrowserAutomationDispatchResultV1Schema, type RuntimeActionExecuteArgs } from '@happier-dev/protocol';

import { handleUiBrowserAutomationDispatchRequest } from './reverseDispatchHandler';
import { createBrowserAutomationControlService } from './controlService';
import { registerBrowserRuntimeControlAdapter, clearBrowserRuntimeControlRegistryForTests } from '../actions/runtimeControlRegistry';
import { applyBrowserControlEvent, createBrowserControlState } from '../control/reducer';
import { buildBrowserAdapterCapabilities } from '../adapters/capabilities';

const view = { browserSessionId: 'visible-session', viewId: 'visible-view' };
const boundView = { ...view, sessionId: 'happier-session' };
const request = { v: 1, ...view, automationRequestId: 'click-1', actionKind: 'click', navigationGeneration: 0, requestedBy: 'agent', requesterRef: { kind: 'agent', id: 'agent-1' }, timeoutMs: 1000, payload: { selector: '#button' } } as const;
const args: RuntimeActionExecuteArgs = { actionId: 'browser.automation.click', input: request,
  context: { surface: 'agent', authority: 'account_automation', defaultSessionId: 'happier-session' } };

function mountView(executePageAction?: (signal: AbortSignal) => Promise<Readonly<{ status: 'succeeded' }>>) {
  const controlService = createBrowserAutomationControlService({ nowMs: () => Date.now() });
  let clicks = 0;
  // The page transport is the real system boundary; controller and Action internals stay real.
  controlService.registerOwner({ ownerId: 'mounted-owner', ...view, navigationGeneration: 0, authority: 'uiLocal', adapterKind: 'localPreview', fidelity: 'injectedPage', trustedInput: false, supportedActions: ['click'], executeAction: async (_request, context) => { clicks += 1; return executePageAction ? executePageAction(context.signal) : { status: 'succeeded', resultSummary: { clicked: true, cookie: 'secret' } }; } });
  const state = applyBrowserControlEvent(applyBrowserControlEvent(createBrowserControlState(), {
    kind: 'sessionCreated', eventId: 'session-created', browserSessionId: view.browserSessionId, profileId: 'profile-1', occurredAt: 1,
  }), {
    kind: 'viewOpened', eventId: 'view-opened', ...view, occurredAt: 2, platform: 'web', adapterKind: 'localPreview', engineKind: 'webIframe',
    target: { kind: 'externalUrl', targetId: 'page', url: 'https://example.test', display: { title: 'Page', addressLabel: 'example.test' } },
    adapterCapabilities: buildBrowserAdapterCapabilities({ adapterKind: 'localPreview', supportedTargetKinds: ['externalUrl'], supportedRenderEngines: ['webIframe'] }),
  });
  const dispose = registerBrowserRuntimeControlAdapter({ browserSessionId: view.browserSessionId, control: { readState: () => state, applyDispatchResult: () => {} }, automation: { controlService } });
  return { dispose, controlService, clicks: () => clicks };
}

afterEach(() => {
  clearBrowserRuntimeControlRegistryForTests();
  vi.useRealTimers();
});

describe('daemon to exact mounted UI browser Action', () => {
  it('binds a legitimate slot-derived browser identity to its invoking Happier Session', async () => {
    const mounted = mountView();
    const result = await handleUiBrowserAutomationDispatchRequest({ v: 1, actionId: args.actionId, input: request,
      authority: 'account_automation', sessionId: 'happier-session' }, { ...view, sessionId: 'happier-session' });
    expect(result).toMatchObject({ status: 'succeeded' });
    expect(mounted.clicks()).toBe(1);
  });

  it('refuses another Happier Session addressing the same mounted pane on the same machine', async () => {
    const mounted = mountView();
    const result = await handleUiBrowserAutomationDispatchRequest({ v: 1, actionId: args.actionId, input: request,
      authority: 'account_automation', sessionId: 'another-session' }, { ...view, sessionId: 'happier-session' });
    expect(result).toMatchObject({ ok: false });
    expect(mounted.clicks()).toBe(0);
  });

  it('aborts the deferred page effect when the invoking transport cancels', async () => {
    let started!: () => void;
    const effectStarted = new Promise<void>(resolve => { started = resolve; });
    let effectSignal: AbortSignal | undefined;
    let settle!: (result: { status: 'succeeded' }) => void;
    const mounted = mountView(signal => {
      effectSignal = signal;
      started();
      return new Promise(resolve => { settle = resolve; });
    });
    const abort = new AbortController();
    const running = handleUiBrowserAutomationDispatchRequest({ v: 1, actionId: args.actionId, input: request,
      authority: 'account_automation', sessionId: boundView.sessionId }, boundView, { signal: abort.signal });
    await effectStarted;
    abort.abort();
    try { expect(effectSignal?.aborted).toBe(true); }
    finally { settle({ status: 'succeeded' }); }
    await expect(running).resolves.toMatchObject({ status: 'interrupted', completion: 'unknown' });
    expect(mounted.controlService.getStatus({ ...request, actionKind: 'getStatus' })?.resultSummary.controller).toBe('none');
  });

  it('clicks the exact mounted page through the public dispatch contract and redacts result egress', async () => {
    const mounted = mountView();
    const wireRequest = UiBrowserAutomationDispatchRequestV1Schema.parse({ v: 1, actionId: args.actionId, input: request,
      authority: args.context.authority, sessionId: boundView.sessionId });
    const result = UiBrowserAutomationDispatchResultV1Schema.parse(await handleUiBrowserAutomationDispatchRequest(wireRequest, boundView));
    expect(result).toMatchObject({ v: 1, status: 'succeeded', adapterKind: 'localPreview', trustedInput: false, resultSummary: { clicked: true } });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(mounted.clicks()).toBe(1);
  });

  it('rejects wrong and retired view identities at the mounted UI owner', async () => {
    const mounted = mountView();
    const raw = { v: 1, actionId: args.actionId, input: request, sessionId: boundView.sessionId };
    expect(await handleUiBrowserAutomationDispatchRequest({ ...raw, input: { ...request, viewId: 'other-view' } }, boundView)).toMatchObject({ ok: false });
    mounted.dispose();
    expect(await handleUiBrowserAutomationDispatchRequest(raw, boundView)).toMatchObject({ ok: false });
    expect(mounted.clicks()).toBe(0);
  });

  it('projects exact controller status and preserves present-user cancellation authority', async () => {
    vi.useFakeTimers();
    let settle!: (result: { status: 'succeeded' }) => void;
    const mounted = mountView(() => new Promise(resolve => { settle = resolve; }));
    const active = mounted.controlService.executeAction(request);
    const invoke = (actionId: string, authority: string) => handleUiBrowserAutomationDispatchRequest({ v: 1, actionId,
      input: actionId === 'browser.automation.status' ? { ...request, automationRequestId: 'status-1', actionKind: 'getStatus' } : view,
      authority, sessionId: boundView.sessionId }, boundView);
    expect(await invoke('browser.automation.cancelActive', 'account_automation')).toEqual({ v: 1, outcome: 'owner_mismatch', canceledCount: 0 });
    expect(await invoke('browser.automation.status', 'account_automation')).toMatchObject({ status: 'succeeded', resultSummary: { controller: 'agent', activeAutomationRequestId: 'click-1' } });
    expect(await invoke('browser.automation.cancelActive', 'present_user')).toEqual({ v: 1, outcome: 'canceled', canceledCount: 1, completion: 'uncertain' });
    settle({ status: 'succeeded' });
    expect(await active).toMatchObject({ status: 'canceled' });
  });
});

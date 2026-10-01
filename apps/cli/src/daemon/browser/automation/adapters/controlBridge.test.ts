import { access, readFile } from 'node:fs/promises';
import type { BrowserCommandV1 } from '@happier-dev/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { BrowserDaemonControlAdapter } from '../../control/types';
import type {
  BrowserSidecarCdpPageHandle,
  BrowserSidecarCdpEventSubscriber,
  BrowserSidecarContextCaptureSurface,
} from '../../sidecar/controlAdapter';
import { createControlAdapterAutomationTransport } from './controlBridge';
import { createBrowserAutomationCdpAdapter } from './cdp';
import { createBrowserAutomationDaemonService } from '../service';
import { createBrowserAutomationRoutes } from '../routes';
import { createBrowserSidecarCdpControlAdapter } from '../../sidecar/controlAdapter';
import { createBrowserContextRoutes } from '../../context/routes';
import { createCdpBrowserContextSource } from '../../context/cdp/source';

function controlAdapter(overrides: Partial<BrowserDaemonControlAdapter> = {}): BrowserDaemonControlAdapter {
  return {
    adapterKind: 'chromiumSidecar',
    ownsView: vi.fn(() => true),
    supportsOpenView: vi.fn(() => false),
    dispatchCommand: vi.fn(async (command: BrowserCommandV1) => ({
      v: 1 as const,
      commandId: command.commandId,
      status: 'dispatched' as const,
      adapterKind: 'chromiumSidecar' as const,
      events: [],
    })),
    ...overrides,
  };
}

const view = { browserSessionId: 'browser_session_1', viewId: 'view_1' } as const;
const HANDLE: BrowserSidecarCdpPageHandle = { targetId: 'target_1', sessionId: 'cdp_1' };

type Responder = (method: string, params: Record<string, unknown> | undefined) => unknown;

function fakeContextCapture(
  responder: Responder,
  resolveHandle: () => BrowserSidecarCdpPageHandle | null = () => HANDLE,
): {
  surface: BrowserSidecarContextCaptureSurface;
  calls: Array<{ method: string; params?: Record<string, unknown> }>;
} {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  return {
    calls,
    surface: {
      transport: {
        dispatchPageCommand: vi.fn(async (input: { method: string; params?: Record<string, unknown> }) => {
          calls.push({ method: input.method, ...(input.params ? { params: input.params } : {}) });
          return responder(input.method, input.params);
        }),
      },
      resolvePageHandle: resolveHandle,
    },
  };
}

type FakeBridgeElement = Readonly<{
  tagName: string;
  textContent: string;
  children: readonly FakeBridgeElement[];
  getAttribute(name: string): string | null;
  getBoundingClientRect(): Readonly<{ left: number; top: number; width: number; height: number }>;
  scrollIntoView(): void;
  focus(): void;
}>;

function bridgeElement(input: Readonly<{
  tagName: string;
  textContent: string;
  attributes?: Readonly<Record<string, string>>;
  rect: Readonly<{ left: number; top: number; width: number; height: number }>;
  children?: readonly FakeBridgeElement[];
}>): FakeBridgeElement {
  return {
    tagName: input.tagName.toUpperCase(),
    textContent: input.textContent,
    children: input.children ?? [],
    getAttribute(name) {
      return input.attributes?.[name] ?? null;
    },
    getBoundingClientRect() {
      return input.rect;
    },
    scrollIntoView() {
      return undefined;
    },
    focus() {
      return undefined;
    },
  };
}

function evaluateBridgeExpression(expression: string, documentValue: Readonly<{ querySelectorAll(selector: string): readonly FakeBridgeElement[] }>): unknown {
  return Function('document', `return ${expression};`)(documentValue);
}

function cdpEvaluateValue(value: unknown): Readonly<{ result: { type: string; value: unknown } }> {
  return {
    result: {
      type: typeof value === 'boolean' ? 'boolean' : typeof value === 'string' ? 'string' : 'object',
      value,
    },
  };
}

function createAggregateTextDocument(): Readonly<{
  button: FakeBridgeElement;
  documentValue: Readonly<{ querySelectorAll(selector: string): readonly FakeBridgeElement[] }>;
}> {
  const button = bridgeElement({
    tagName: 'button',
    textContent: 'Continue',
    attributes: { id: 'continue' },
    rect: { left: 20, top: 10, width: 50, height: 20 },
  });
  const main = bridgeElement({
    tagName: 'main',
    textContent: 'Choose an action Continue',
    rect: { left: 0, top: 0, width: 300, height: 200 },
    children: [button],
  });
  const body = bridgeElement({
    tagName: 'body',
    textContent: 'Welcome Choose an action Continue',
    rect: { left: 0, top: 0, width: 800, height: 600 },
    children: [main],
  });
  const html = bridgeElement({
    tagName: 'html',
    textContent: 'Welcome Choose an action Continue',
    rect: { left: 0, top: 0, width: 1000, height: 800 },
    children: [body],
  });
  return {
    button,
    documentValue: {
      querySelectorAll(selector) {
        return selector === '*' ? [html, body, main, button] : [];
      },
    },
  };
}

describe('control adapter automation transport bridge', () => {
  it('dispatches streamed-view coordinates without requiring a DOM selector', async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const transport = { openPage: async () => HANDLE, dispatchBrowserCommand: async () => ({}),
      dispatchPageCommand: async (command: (typeof calls)[number]) => { calls.push(command); return {}; } };
    const adapter = createBrowserSidecarCdpControlAdapter({ browserSessionId: view.browserSessionId, sidecarId: 'sidecar', transport });
    await adapter.dispatchCommand({ kind: 'openView', commandId: 'open', focus: true, ...view, platform: 'web',
      target: { kind: 'externalUrl', targetId: 'external', url: 'https://example.test/' } });
    const bridge = createControlAdapterAutomationTransport({ adapter,
      contextCapture: { transport, resolvePageHandle: adapter.resolvePageHandle } });
    expect(await bridge.dispatchInputCommand?.({ ...view, actionKind: 'tap', navigationGeneration: 0, payload: { x: 200, y: 100 } })).toEqual({ ok: true });
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'Input.dispatchMouseEvent', params: expect.objectContaining({ type: 'mousePressed', x: 200, y: 100 }) }),
      expect.objectContaining({ method: 'Input.dispatchMouseEvent', params: expect.objectContaining({ type: 'mouseReleased', x: 200, y: 100 }) }),
    ]));
    adapter.dispose();
  });
  it('auto-dismisses navigation dialogs for the whole adapter operation', async () => {
    const listeners = new Set<BrowserSidecarCdpEventSubscriber>();
    const { surface, calls } = fakeContextCapture(method => {
      if (method === 'Page.navigate') for (const listener of listeners) listener({ method: 'Page.javascriptDialogOpening', sessionId: HANDLE.sessionId, params: { type: 'alert', message: 'private' } });
      return {};
    });
    const boundary = { ...surface.transport, openPage: async () => HANDLE, dispatchBrowserCommand: async () => ({}), subscribeCdpEvents: (listener: BrowserSidecarCdpEventSubscriber) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
    const control = createBrowserSidecarCdpControlAdapter({ browserSessionId: view.browserSessionId, sidecarId: 'sidecar', transport: boundary });
    await control.dispatchCommand({ kind: 'openView', commandId: 'open', focus: true, ...view, platform: 'web', target: { kind: 'externalUrl', targetId: 'external', url: 'https://example.test/start' } });
    const listenerCount = listeners.size;
    const adapter = createBrowserAutomationCdpAdapter({ transport: createControlAdapterAutomationTransport({
      adapter: control,
      contextCapture: { transport: boundary, resolvePageHandle: control.resolvePageHandle, subscribeCdpEvents: boundary.subscribeCdpEvents },
    }) });
    const result = await adapter.execute({ v: 1, ...view, automationRequestId: 'navigation_dialog', actionKind: 'navigate', navigationGeneration: 1, requestedBy: 'agent', requesterRef: { kind: 'agent', id: 'agent_1' }, timeoutMs: 5000, payload: { url: 'https://example.test' } });
    expect(result).toMatchObject({ status: 'succeeded', resultSummary: { javascriptDialogs: { count: 1, kinds: ['alert'], handling: 'dismissed' } } });
    expect(calls).toContainEqual({ method: 'Page.navigate', params: { url: 'https://example.test' } });
    expect(calls).toContainEqual({ method: 'Page.handleJavaScriptDialog', params: { accept: false } });
    expect(listeners.size).toBe(listenerCount);
    control.dispose();
  });
  it('dismisses page dialogs and reports only successful handling metadata', async () => {
    let listener: BrowserSidecarCdpEventSubscriber | undefined;
    const { surface, calls } = fakeContextCapture((method) => {
      if (method === 'Input.insertText') listener?.({ method: 'Page.javascriptDialogOpening', sessionId: HANDLE.sessionId, params: { type: 'prompt', message: 'private dialog content', defaultPrompt: 'secret' } });
      return {};
    });
    const unsubscribe = vi.fn();
    const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: { ...surface, subscribeCdpEvents: callback => { listener = callback; return unsubscribe; } } });
    const result = await createBrowserAutomationCdpAdapter({ transport }).execute({ v: 1, ...view, automationRequestId: 'input_dialog', requestedBy: 'agent', requesterRef: { kind: 'agent', id: 'agent_1' }, timeoutMs: 5000, actionKind: 'type', navigationGeneration: 1, payload: { text: 'hello' } });
    expect(result).toMatchObject({ status: 'succeeded', resultSummary: { javascriptDialogs: { count: 1, kinds: ['prompt'], handling: 'dismissed' } } });
    expect(calls).toContainEqual({ method: 'Page.handleJavaScriptDialog', params: { accept: false } });
    expect(JSON.stringify(result)).not.toContain('private dialog content');
    expect(unsubscribe).toHaveBeenCalled();
  });
  it('waits for a later matching element within the containing deadline', async () => {
    vi.useFakeTimers();
    try {
      let present = false;
      const { surface } = fakeContextCapture(() => cdpEvaluateValue(present));
      const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface });
      const pending = transport.dispatchPageQuery({ ...view, actionKind: 'waitFor', navigationGeneration: 1, payload: { selector: '#later' }, deadlineMs: Date.now() + 1000 });
      await vi.advanceTimersByTimeAsync(200);
      present = true;
      await vi.advanceTimersByTimeAsync(200);
      expect(await pending).toMatchObject({ ok: true, data: { present: true } });
    } finally { vi.useRealTimers(); }
  });

  it('reports deadline expiry and cancellation without evaluating again', async () => {
    vi.useFakeTimers();
    try {
      const { surface, calls } = fakeContextCapture(() => cdpEvaluateValue(false));
      const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface });
      const controller = new AbortController();
      const canceled = transport.dispatchPageQuery({ ...view, actionKind: 'waitFor', navigationGeneration: 1, payload: { selector: '#later' }, deadlineMs: Date.now() + 1000, signal: controller.signal });
      await vi.advanceTimersByTimeAsync(100);
      controller.abort();
      expect(await canceled).toMatchObject({ ok: false, errorCode: 'user_canceled' });
      const count = calls.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toHaveLength(count);
      const expired = transport.dispatchPageQuery({ ...view, actionKind: 'waitFor', navigationGeneration: 1, payload: { selector: '#later' }, deadlineMs: Date.now() + 300 });
      await vi.advanceTimersByTimeAsync(300);
      expect(await expired).toMatchObject({ ok: false, errorCode: 'timed_out' });
    } finally { vi.useRealTimers(); }
  });

  it('uploads file descriptors to the resolved DOM file input and cleans request-owned bytes', async () => {
    let uploadedFiles: string[] = [];
    const { surface } = fakeContextCapture(async (method, params) => {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'file-input' } };
      if (method === 'DOM.setFileInputFiles') {
        uploadedFiles = params?.files as string[];
        expect(params?.objectId).toBe('file-input');
        expect(await readFile(uploadedFiles[0], 'utf8')).toBe('Hello upload');
      }
      return {};
    });
    const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface });
    const result = await transport.dispatchInputCommand?.({ ...view, actionKind: 'upload', navigationGeneration: 1, payload: { selector: '#files', files: [{ name: 'example.txt', mimeType: 'text/plain', text: 'Hello upload' }] } });
    expect(result).toMatchObject({ ok: true, data: { fileCount: 1 } });
    expect(uploadedFiles).toHaveLength(1);
    await expect(access(uploadedFiles[0])).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('drags between locator centres through trusted mouse events', async () => {
    const { surface, calls } = fakeContextCapture((method, params) => method === 'Runtime.evaluate' ? cdpEvaluateValue(String(params?.expression).includes('#target') ? { x: 100, y: 200 } : { x: 10, y: 20 }) : {});
    const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface });
    const result = await transport.dispatchInputCommand?.({ ...view, actionKind: 'drag', navigationGeneration: 1, payload: { from: '#source', to: '#target' } });
    expect(result).toMatchObject({ ok: true });
    expect(calls.filter(c => c.method === 'Input.dispatchMouseEvent').map(c => c.params)).toEqual([
      { type: 'mouseMoved', x: 10, y: 20 },
      { type: 'mousePressed', x: 10, y: 20, button: 'left', buttons: 1, clickCount: 1 },
      { type: 'mouseMoved', x: 100, y: 200, button: 'left', buttons: 1 },
      { type: 'mouseReleased', x: 100, y: 200, button: 'left', buttons: 0, clickCount: 1 },
    ]);
  });
  it('cleans duplicate-name binary uploads even when Chromium rejects selection', async () => {
    let uploadedFiles: string[] = [];
    const bytes = Buffer.from([0, 255, 128, 10]);
    const { surface } = fakeContextCapture(async (method, params) => {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'file-input' } };
      if (method === 'DOM.setFileInputFiles') {
        uploadedFiles = params?.files as string[];
        expect(uploadedFiles[0]).not.toBe(uploadedFiles[1]);
        for (const file of uploadedFiles) expect(await readFile(file)).toEqual(bytes);
        throw new Error('CDP selection rejected');
      }
      return {};
    });
    const descriptor = { name: 'same.bin', mimeType: 'application/octet-stream', text: bytes.toString('base64'), base64: true };
    const result = await createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface }).dispatchInputCommand?.({ ...view, actionKind: 'upload', navigationGeneration: 1, payload: { selector: '#files', files: [descriptor, descriptor] } });
    expect(result).toMatchObject({ ok: false, errorCode: 'runtime_unavailable' });
    expect(uploadedFiles).toHaveLength(2);
    for (const file of uploadedFiles) await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['click', 'press', 'drag'] as const)('drains canceled %s and releases held input before the route acknowledges', async (actionKind) => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const { surface, calls } = fakeContextCapture((method, params) => {
      if (method === 'Runtime.evaluate') return cdpEvaluateValue({ x: 60, y: 40 });
      if (params?.type === 'mousePressed' || params?.type === 'keyDown') {
        entered();
        return blocked;
      }
      return {};
    });
    const service = createBrowserAutomationDaemonService({
      adapter: createBrowserAutomationCdpAdapter({
        transport: createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface }),
      }),
    });
    const routes = createBrowserAutomationRoutes({ service });
    const pending = service.execute({
      v: 1, ...view, automationRequestId: 'cancel_input', actionKind,
      navigationGeneration: 0, timeoutMs: 5000,
      requestedBy: 'agent', requesterRef: { kind: 'agent', id: 'agent_1' },
      payload: actionKind === 'drag' ? { from: '#source', to: '#target' } : { selector: '#submit', key: 'Enter' },
    });
    await started;
    let acknowledged = false;
    const cancel = routes.dispatch('browser.automation.cancelActive', view, { authority: 'present_user' })
      .then((result) => { acknowledged = true; return result; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(acknowledged).toBe(false);
    expect(service.getStatus(view).activeAutomationRequestId).toBe('cancel_input');
    release();
    expect(await cancel).toMatchObject({ outcome: 'canceled', completion: 'stopped' });
    expect(await pending).toMatchObject({ status: 'canceled', resultSummary: { completion: 'stopped' } });
    const effectsAtAck = calls.length;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toHaveLength(effectsAtAck);
    expect(calls.at(-1)?.params?.type).toBe(actionKind === 'press' ? 'keyUp' : 'mouseReleased');
    expect(service.getStatus(view).controller).toBe('human');
  });

  it('does not insert text after cancellation during selector resolution', async () => {
    const controller = new AbortController();
    const { surface, calls } = fakeContextCapture((method) => {
      if (method === 'Runtime.evaluate') {
        controller.abort('user_canceled');
        return cdpEvaluateValue({ x: 10, y: 10 });
      }
      return {};
    });
    const adapter = createBrowserAutomationCdpAdapter({
      transport: createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface }),
    });
    const result = await adapter.execute({
      v: 1, ...view, automationRequestId: 'cancel_type', actionKind: 'type',
      navigationGeneration: 0, timeoutMs: 5000,
      requestedBy: 'agent', requesterRef: { kind: 'agent', id: 'agent_1' },
      payload: { selector: '#name', text: 'must not land' },
    }, { signal: controller.signal });
    expect(result).toMatchObject({ status: 'canceled', interruptionCompletion: 'stopped' });
    expect(calls.some((call) => call.method === 'Input.insertText')).toBe(false);
  });
  it('reports uncertain interruption when Chromium cannot confirm held-input release', async () => {
    const controller = new AbortController();
    const { surface } = fakeContextCapture((method, params) => {
      if (method === 'Runtime.evaluate') return cdpEvaluateValue({ x: 10, y: 10 });
      if (params?.type === 'mousePressed') controller.abort('user_canceled');
      if (params?.type === 'mouseReleased') throw new Error('CDP disconnected');
      return {};
    });
    const adapter = createBrowserAutomationCdpAdapter({ transport: createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface }) });
    expect(await adapter.execute({ v: 1, ...view, automationRequestId: 'uncertain', actionKind: 'click', navigationGeneration: 0, timeoutMs: 5000,
      requestedBy: 'agent', requesterRef: { kind: 'agent', id: 'agent_1' }, payload: { selector: '#go' },
    }, { signal: controller.signal })).toMatchObject({ status: 'canceled', interruptionCompletion: 'uncertain' });
  });
  it('requires explicit hand back and a fresh observation before agent input resumes', async () => {
    const { surface } = fakeContextCapture((method) => method === 'Runtime.evaluate' ? cdpEvaluateValue({ x: 10, y: 10 }) : {});
    const service = createBrowserAutomationDaemonService({ adapter: createBrowserAutomationCdpAdapter({
      transport: createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface }),
    }) });
    const action = { v: 1 as const, ...view, automationRequestId: 'held', actionKind: 'click' as const,
      navigationGeneration: 0, timeoutMs: 5000, requestedBy: 'agent' as const,
      requesterRef: { kind: 'agent' as const, id: 'agent_1' }, payload: { selector: '#go' } };
    await service.cancelActive({ ...view, authority: 'present_user' });
    expect(service.getStatus(view).controller).toBe('human');
    expect(await service.execute(action)).toMatchObject({ errorCode: 'human_interrupted' });
    service.handBack({ ...view, authority: 'present_user' });
    expect(await service.execute(action)).toMatchObject({ errorCode: 'stale_navigation' });
    expect(await service.execute({ ...action, actionKind: 'snapshot', payload: {} })).toMatchObject({ status: 'succeeded' });
    expect(await service.execute(action)).toMatchObject({ status: 'succeeded' });
    expect(await service.execute({ ...action, navigationGeneration: 9 })).toMatchObject({ errorCode: 'stale_navigation' });
  });
  it('delegates ownsView to the control adapter', () => {
    const adapter = controlAdapter({ ownsView: vi.fn(() => false) });
    const transport = createControlAdapterAutomationTransport({ adapter });
    expect(transport.ownsView(view)).toBe(false);
  });

  it('fails page queries closed because the control adapter exposes no CDP query producer', async () => {
    const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter() });

    const result = await transport.dispatchPageQuery({
      ...view,
      actionKind: 'snapshot',
      navigationGeneration: 1,
      payload: {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('runtime_unavailable');
  });

  // MCH-3: read-only page queries ride the live CDP transport the control adapter opened.
  it('runs a snapshot query over the live CDP transport when a context-capture surface is present', async () => {
    const { surface, calls } = fakeContextCapture((method) => {
      if (method === 'Runtime.evaluate') {
        return { result: { type: 'string', value: '  Hello   page  ' } };
      }
      return {};
    });
    const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface });

    const result = await transport.dispatchPageQuery({
      ...view,
      actionKind: 'snapshot',
      navigationGeneration: 1,
      payload: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as { text?: string })?.text).toContain('Hello page');
    expect(calls.some((c) => c.method === 'Runtime.evaluate')).toBe(true);
  });

  it('routes the production snapshot verb through the rich browser-context snapshot producer', async () => {
    // Keep route/capture/source logic real; only Chromium and screenshot persistence are boundaries.
    const { surface } = fakeContextCapture((method, params) => {
      if (method === 'Runtime.evaluate') {
        if (String(params?.expression).includes('input[type="password"]')) return cdpEvaluateValue(false);
        if (String(params?.expression).includes('getBoundingClientRect')) return cdpEvaluateValue([
          { role: 'button', name: 'Submit', selector: '#submit', rect: { x: 10, y: 20, width: 80, height: 32 } },
        ]);
        return cdpEvaluateValue('Welcome back');
      }
      if (method === 'Page.getNavigationHistory') return { currentIndex: 0, entries: [{ id: 1, url: 'https://example.test/welcome', title: 'Welcome' }] };
      if (method === 'Accessibility.getFullAXTree') return { nodes: [{ nodeId: 'node_1', ignored: false, role: { type: 'role', value: 'button' }, name: { type: 'computedString', value: 'Submit' } }] };
      if (method === 'Page.captureScreenshot') return { data: 'AQID' };
      return {};
    });
    const transport = createControlAdapterAutomationTransport({
      adapter: controlAdapter(),
      contextCapture: surface,
      browserContext: createBrowserContextRoutes({
        ownerAccountId: 'owner',
        resolveGate: () => ({ featureEnabled: true, policyAllowed: true, runtimeAvailable: true }),
        source: createCdpBrowserContextSource({
          transport: surface.transport,
          resolveView: () => HANDLE,
          screenshotMediaWriter: { write: async () => ({ ok: true, media: { mediaId: 'media_snapshot', mediaKind: 'image', width: 800, height: 600, sizeBytes: 4096 } }) },
        }),
      }),
    });

    const result = await transport.dispatchPageQuery({
      ...view,
      actionKind: 'snapshot',
      navigationGeneration: 7,
      payload: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      navigationGeneration: 7,
      visibleText: 'Welcome back',
      axNodes: [{ role: 'button', name: 'Submit' }],
      interactiveElements: [
        { role: 'button', name: 'Submit', selector: '#submit' },
      ],
    });
    expect((result.data as { media?: { mediaId?: string } }).media?.mediaId).toBe('media_snapshot');
  });

  // BA-2: the rich semantic snapshot returns interactiveElements[{role,name,selector,rect}] with
  // synthesized stable selectors so the agent can act by resilient locator, not coordinates.
  it('returns interactive elements with synthesized selector + rect for semanticSnapshot', async () => {
    const elements = [
      { role: 'button', name: 'Save', tag: 'button', selector: '#save', rect: { x: 10, y: 20, width: 80, height: 30 } },
      {
        role: 'textbox',
        name: 'Email',
        tag: 'input',
        selector: '[data-testid="email"]',
        rect: { x: 0, y: 60, width: 200, height: 24 },
      },
    ];
    const { surface, calls } = fakeContextCapture((method, params) => {
      if (method === 'Runtime.evaluate') {
        const expression = typeof params?.expression === 'string' ? params.expression : '';
        // The evaluator must synthesize selectors + rects in-page, not just role/name/tag.
        expect(expression).toContain('getBoundingClientRect');
        expect(expression).toContain('data-testid');
        return { result: { type: 'object', value: elements } };
      }
      return {};
    });
    const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface });

    const result = await transport.dispatchPageQuery({
      ...view,
      actionKind: 'semanticSnapshot',
      navigationGeneration: 1,
      payload: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { elements?: ReadonlyArray<Record<string, unknown>> };
    expect(data.elements).toHaveLength(2);
    expect(data.elements?.[0]).toMatchObject({ role: 'button', name: 'Save', selector: '#save' });
    expect(data.elements?.[0]?.rect).toMatchObject({ x: 10, y: 20, width: 80, height: 30 });
    expect(data.elements?.[1]?.selector).toBe('[data-testid="email"]');
    expect(calls.some((c) => c.method === 'Runtime.evaluate')).toBe(true);
  });

  it('fails a query view_closed when the page handle cannot be resolved', async () => {
    const { surface } = fakeContextCapture(() => ({}), () => null);
    const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface });

    const result = await transport.dispatchPageQuery({
      ...view,
      actionKind: 'getStatus',
      navigationGeneration: 0,
      payload: {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('view_closed');
  });

  it('resolves semantic and CSS locators through the production query and wait paths', async () => {
    const { surface } = fakeContextCapture((method, params) => {
      if (method !== 'Runtime.evaluate') return {};
      const expression = typeof params?.expression === 'string' ? params.expression : '';
      if (expression.includes('querySelectorAll("role=') || expression.includes('querySelector("role=')) {
        return { result: { type: 'object', value: { error: 'invalid_selector' } } };
      }
      if (expression.includes('querySelectorAll("text=') || expression.includes('querySelector("text=')) {
        return { result: { type: 'object', value: { error: 'invalid_selector' } } };
      }
      if (expression.includes('querySelectorAll("data-testid=') || expression.includes('querySelector("data-testid=')) {
        return { result: { type: 'object', value: { error: 'invalid_selector' } } };
      }
      if (expression.includes('!!(') && expression.includes('getAttribute') && expression.includes('role')) {
        return { result: { type: 'boolean', value: true } };
      }
      if (expression.includes('getAttribute') && expression.includes('role') && expression.includes('Save')) {
        return { result: { type: 'object', value: { count: 1, elements: [{ tag: 'button', name: 'Save' }] } } };
      }
      if (expression.includes('textContent') && expression.includes('Continue')) {
        return { result: { type: 'object', value: { count: 1, elements: [{ tag: 'a', name: 'Continue' }] } } };
      }
      if (expression.includes('data-testid') && expression.includes('email-field')) {
        return { result: { type: 'object', value: { count: 1, elements: [{ tag: 'input', name: 'Email' }] } } };
      }
      if (expression.includes('querySelectorAll("#save")')) {
        return { result: { type: 'object', value: { count: 1, elements: [{ tag: 'button', name: 'Save' }] } } };
      }
      return { result: { type: 'object', value: { count: 0, elements: [] } } };
    });
    const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface });

    for (const selector of ['role=button[name="Save"]', 'text=Continue', 'data-testid=email-field', '#save']) {
      const result = await transport.dispatchPageQuery({
        ...view,
        actionKind: 'queryElements',
        navigationGeneration: 1,
        payload: { selector },
      });
      expect(result.ok, selector).toBe(true);
      if (!result.ok) continue;
      expect((result.data as { count?: number }).count, selector).toBe(1);
    }

    const waitResult = await transport.dispatchPageQuery({
      ...view,
      actionKind: 'waitFor',
      navigationGeneration: 1,
      payload: { selector: 'role=button[name="Save"]' },
    });
    expect(waitResult.ok).toBe(true);
    if (!waitResult.ok) return;
    expect(waitResult.data).toMatchObject({ present: true });
  });

  it('executes text locators against aggregate DOM text without targeting structural ancestors', async () => {
    const { documentValue } = createAggregateTextDocument();
    const { surface, calls } = fakeContextCapture((method, params) => {
      if (method !== 'Runtime.evaluate') return {};
      const expression = typeof params?.expression === 'string' ? params.expression : '';
      return cdpEvaluateValue(evaluateBridgeExpression(expression, documentValue));
    });
    const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface });

    const queryResult = await transport.dispatchPageQuery({
      ...view,
      actionKind: 'queryElements',
      navigationGeneration: 1,
      payload: { selector: 'text=Continue' },
    });
    expect(queryResult.ok).toBe(true);
    if (!queryResult.ok) return;
    expect(queryResult.data).toMatchObject({
      count: 1,
      elements: [{ tag: 'button', name: 'Continue' }],
    });

    const waitResult = await transport.dispatchPageQuery({
      ...view,
      actionKind: 'waitFor',
      navigationGeneration: 1,
      payload: { selector: 'text=Continue' },
    });
    expect(waitResult.ok).toBe(true);
    if (!waitResult.ok) return;
    expect(waitResult.data).toMatchObject({ present: true });

    const clickResult = await transport.dispatchInputCommand?.({
      ...view,
      actionKind: 'click',
      navigationGeneration: 1,
      payload: { selector: 'text=Continue' },
    });
    expect(clickResult?.ok).toBe(true);
    const pressed = calls.find((call) => call.method === 'Input.dispatchMouseEvent' && call.params?.type === 'mousePressed');
    expect(pressed?.params).toMatchObject({ x: 45, y: 20, button: 'left' });
  });

  // MCH-4: mutating input verbs dispatch CDP Input.* over the same transport.
  it('exposes dispatchInputCommand only when a context-capture surface is present', () => {
    expect(createControlAdapterAutomationTransport({ adapter: controlAdapter() }).dispatchInputCommand).toBeUndefined();
    const { surface } = fakeContextCapture(() => ({}));
    expect(
      createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface }).dispatchInputCommand,
    ).toBeTypeOf('function');
  });

  it.each<Readonly<{
    tagName: string;
    textContent: string;
    attributes: Readonly<Record<string, string>>;
    selector: string;
    label: string | undefined;
  }>>([
    { tagName: 'button', textContent: 'Submit', attributes: {}, selector: '#submit', label: 'Submit' },
    { tagName: 'button', textContent: 'Continue', attributes: { 'aria-label': 'Sign in' }, selector: 'role=button[name="Sign in"]', label: 'Sign in' },
    { tagName: 'button', textContent: 'Open https://example.test/?token=private-value', attributes: {}, selector: '#submit', label: 'Open https://example.test/' },
    { tagName: 'input', textContent: 'password-value', attributes: { type: 'password', value: 'password-value' }, selector: '#submit', label: undefined },
    { tagName: 'textarea', textContent: 'typed-secret', attributes: {}, selector: '#submit', label: undefined },
    { tagName: 'div', textContent: 'typed-secret', attributes: { contenteditable: 'true' }, selector: '#submit', label: undefined },
  ])('dispatches a click to CDP Input.dispatchMouseEvent at the resolved element center ($tagName, $selector)', async ({ tagName, textContent, attributes, selector, label }) => {
    const element = bridgeElement({ tagName, textContent, attributes, rect: { left: 40, top: 20, width: 40, height: 40 } });
    const documentValue = { querySelector: () => element, querySelectorAll: () => [element] };
    const targets: unknown[] = [];
    const { surface, calls } = fakeContextCapture((method, params) => {
      if (method === 'Runtime.evaluate') {
        const expression = String(params?.expression);
        // CDP is the boundary; execute the production page expression with its viewport.
        return cdpEvaluateValue(Function('document', 'innerWidth', 'innerHeight', `return ${expression};`)(documentValue, 200, 100));
      }
      return {};
    });
    const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface });

    const result = await transport.dispatchInputCommand?.({
      ...view,
      actionKind: 'click',
      navigationGeneration: 1,
      payload: { selector },
      onActiveTarget: (target) => targets.push(target),
    });

    expect(result?.ok).toBe(true);
    const pressed = calls.find((c) => c.method === 'Input.dispatchMouseEvent' && c.params?.type === 'mousePressed');
    expect(pressed?.params).toMatchObject({ x: 60, y: 40, button: 'left' });
    expect(targets).toEqual([{ x: 0.3, y: 0.4, width: 0.2, height: 0.4, ...(label ? { label } : {}) }]);
  });

  it('resolves semantic and CSS locators before dispatching input commands', async () => {
    const { surface, calls } = fakeContextCapture((method, params) => {
      if (method !== 'Runtime.evaluate') return {};
      const expression = typeof params?.expression === 'string' ? params.expression : '';
      if (expression.includes('querySelector("role=')
        || expression.includes('querySelector("text=')
        || expression.includes('querySelector("data-testid=')) {
        return { result: { type: 'object', value: null } };
      }
      if (
        (expression.includes('getAttribute') && expression.includes('role') && expression.includes('Save'))
        || (expression.includes('textContent') && expression.includes('Continue'))
        || (expression.includes('data-testid') && expression.includes('email-field'))
        || expression.includes('querySelector("#save")')
      ) {
        return { result: { type: 'object', value: { x: 40, y: 24 } } };
      }
      return { result: { type: 'object', value: null } };
    });
    const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface });

    for (const selector of ['role=button[name="Save"]', 'text=Continue', 'data-testid=email-field', '#save']) {
      const result = await transport.dispatchInputCommand?.({
        ...view,
        actionKind: 'click',
        navigationGeneration: 1,
        payload: { selector },
      });
      expect(result?.ok, selector).toBe(true);
    }

    const pressEvents = calls.filter((call) => call.method === 'Input.dispatchMouseEvent' && call.params?.type === 'mousePressed');
    expect(pressEvents).toHaveLength(4);
    for (const event of pressEvents) {
      expect(event.params).toMatchObject({ x: 40, y: 24, button: 'left' });
    }
  });

  it('inserts text via CDP Input.insertText for a type verb', async () => {
    const { surface, calls } = fakeContextCapture((method) => {
      if (method === 'Runtime.evaluate') {
        return { result: { type: 'object', value: { x: 10, y: 10 } } };
      }
      return {};
    });
    const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface });

    const result = await transport.dispatchInputCommand?.({
      ...view,
      actionKind: 'type',
      navigationGeneration: 1,
      payload: { selector: '#name', text: 'hello' },
    });

    expect(result?.ok).toBe(true);
    const insert = calls.find((c) => c.method === 'Input.insertText');
    expect(insert?.params).toMatchObject({ text: 'hello' });
  });

  it('reports selector_not_found when a click target cannot be resolved', async () => {
    const { surface } = fakeContextCapture((method) => {
      if (method === 'Runtime.evaluate') return { result: { type: 'object', value: null } };
      return {};
    });
    const transport = createControlAdapterAutomationTransport({ adapter: controlAdapter(), contextCapture: surface });

    const result = await transport.dispatchInputCommand?.({
      ...view,
      actionKind: 'click',
      navigationGeneration: 1,
      payload: { selector: '#missing' },
    });

    expect(result?.ok).toBe(false);
    if (result?.ok) return;
    expect(result?.errorCode).toBe('selector_not_found');
  });
});

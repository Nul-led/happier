import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestMessageChannel } from '@/dev/testkit/mocks/messageChannel';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import {
    applyBrowserDiagnosticEvents,
    createBrowserDiagnosticsUiStore,
    selectBrowserDiagnosticsForView,
} from '@/sync/domains/browser/diagnostics';

import { WebIframeEngine } from './WebIframeEngine';

type TestWindow = Window & typeof globalThis;

function installTestWindow(): TestWindow {
    const target = new EventTarget() as TestWindow;
    vi.stubGlobal('window', target);
    return target;
}

function dispatchMessage(
    target: TestWindow,
    input: Readonly<{
        data: unknown;
        origin: string;
        source?: MessageEventSource | null;
        ports?: readonly MessagePort[];
    }>,
): void {
    const event = new Event('message') as MessageEvent;
    Object.defineProperties(event, {
        data: {
            value: input.data,
        },
        origin: {
            value: input.origin,
        },
        source: {
            value: input.source ?? null,
        },
        ports: {
            value: input.ports ?? [],
        },
    });
    target.dispatchEvent(event);
}

function diagnosticBatch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        v: 1,
        kind: 'browser.diagnostics.events',
        browserSessionId: 'browser_session_1',
        viewId: 'view_1',
        navigationGeneration: 6,
        collector: {
            collectorId: 'collector_1',
            nonce: 'nonce_1',
            version: '1.0.0',
        },
        events: [
            {
                v: 1,
                eventId: 'evt_page_1',
                browserSessionId: 'browser_session_1',
                viewId: 'view_1',
                navigationGeneration: 6,
                capturedAtMs: 2_000,
                family: 'pageInfo',
                kind: 'pageInfo.snapshot',
                fidelity: 'injectedPage',
                trusted: false,
                collector: {
                    collectorId: 'collector_1',
                    nonce: 'nonce_1',
                    version: '1.0.0',
                },
                data: {
                    url: 'https://preview.example.test/app?token=secret#panel',
                },
                redaction: {
                    level: 'metadataOnly',
                },
            },
        ],
        ...overrides,
    };
}

describe('WebIframeEngine diagnostics wiring', () => {
    it.each(['unmount', 'navigation', 'source replacement'] as const)('does not deliver a pending bridge response after %s retirement', async (retirement) => {
        const testWindow = installTestWindow();
        const iframeSource = { postMessage: vi.fn() } as unknown as WindowProxy;
        let finish!: (response: unknown) => void;
        const pending = new Promise((resolve) => { finish = resolve; });
        const webMessageBridge = {
            targetOrigin: '*',
            allowWildcardTargetOrigin: true,
            onMessage: () => pending,
        };
        const screen = await renderScreen(
            <WebIframeEngine
                title="Inline"
                html="<p>Inline</p>"
                sandbox="allow-scripts"
                testID="inline-frame"
                revokeOnUnexpectedNavigation
                webMessageBridge={webMessageBridge}
            />,
            { createNodeMock: (element) => element.type === 'iframe' ? { contentWindow: iframeSource } : null },
        );
        await act(async () => dispatchMessage(testWindow, {
            data: 'request', origin: 'null', source: iframeSource,
        }));
        if (retirement === 'unmount') {
            await screen.unmount();
        } else if (retirement === 'source replacement') {
            await screen.update(<WebIframeEngine title="Inline" html="<p>Replacement</p>" sandbox="allow-scripts" testID="inline-frame" revokeOnUnexpectedNavigation webMessageBridge={webMessageBridge} />);
        } else {
            const iframe = screen.findByType('iframe');
            await act(async () => {
                iframe.props.onLoad();
                iframe.props.onLoad();
            });
        }
        await act(async () => { finish({ result: 'retired-data' }); });
        expect(iframeSource.postMessage).not.toHaveBeenCalled();
    });

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('accepts injected iframe diagnostics through an explicit-origin postMessage bridge only', async () => {
        const testWindow = installTestWindow();
        const iframeSource = { postMessage: vi.fn() } as unknown as WindowProxy;
        const otherSource = { postMessage: vi.fn() } as unknown as WindowProxy;
        const rejectedMessages: string[] = [];
        const collectorScripts: string[] = [];
        let store = createBrowserDiagnosticsUiStore();

        await renderScreen(
            <WebIframeEngine
                title="Preview"
                url="https://preview.example.test/app"
                sandbox="allow-scripts"
                testID="browser-web-frame"
                diagnostics={{
                    browserSessionId: 'browser_session_1',
                    viewId: 'view_1',
                    navigationGeneration: 6,
                    collectorId: 'collector_1',
                    nonce: 'nonce_1',
                    collectorVersion: '1.0.0',
                    sourceOrigin: 'https://preview.example.test',
                    webPostMessageTargetOrigin: 'https://app.example.test',
                    onCollectorScriptReady: (script) => {
                        collectorScripts.push(script);
                    },
                    onEvents: (events) => {
                        store = applyBrowserDiagnosticEvents(store, { events });
                    },
                    onRejectedMessage: (reasonCode) => {
                        rejectedMessages.push(reasonCode);
                    },
                }}
            />,
            {
                createNodeMock: (element) => (
                    (element as { type?: string }).type === 'iframe'
                        ? { contentWindow: iframeSource }
                        : null
                ),
            },
        );

        expect(collectorScripts).toHaveLength(1);
        expect(collectorScripts[0]).toContain('"webPostMessageTargetOrigin":"https://app.example.test"');
        expect(collectorScripts[0]).not.toContain("postMessage(serialized, '*')");

        dispatchMessage(testWindow, {
            data: JSON.stringify(diagnosticBatch()),
            origin: 'https://evil.example.test',
        });
        dispatchMessage(testWindow, {
            data: JSON.stringify(diagnosticBatch({ navigationGeneration: 5 })),
            origin: 'https://preview.example.test',
            source: iframeSource,
        });
        dispatchMessage(testWindow, {
            data: JSON.stringify(diagnosticBatch()),
            origin: 'https://preview.example.test',
            source: otherSource,
        });
        dispatchMessage(testWindow, {
            data: JSON.stringify(diagnosticBatch()),
            origin: 'https://preview.example.test',
            source: iframeSource,
        });

        expect(selectBrowserDiagnosticsForView(store, {
            browserSessionId: 'browser_session_1',
            viewId: 'view_1',
        })).toMatchObject({
            status: 'available',
            eventCount: 1,
            fidelity: 'injectedPage',
            trusted: false,
            events: [
                expect.objectContaining({
                    summary: 'https://preview.example.test/app',
                }),
            ],
        });
        expect(rejectedMessages).toEqual(['origin_mismatch', 'navigation_stale', 'source_mismatch']);
    });

    it('normalizes protocol-shaped iframe source origins for diagnostics messages and commands', async () => {
        const testWindow = installTestWindow();
        const iframeSource = { postMessage: vi.fn() } as unknown as WindowProxy;
        const rejectedMessages: string[] = [];
        let store = createBrowserDiagnosticsUiStore();

        await renderScreen(
            <WebIframeEngine
                title="Preview"
                url="https://preview.example.test/app"
                sandbox="allow-scripts"
                testID="browser-web-frame"
                diagnostics={{
                    browserSessionId: 'browser_session_1',
                    viewId: 'view_1',
                    navigationGeneration: 6,
                    collectorId: 'collector_1',
                    nonce: 'nonce_1',
                    collectorVersion: '1.0.0',
                    sourceOrigin: 'https://preview.example.test/',
                    webPostMessageTargetOrigin: 'https://app.example.test/',
                    evalRequest: {
                        v: 1,
                        evalRequestId: 'eval_1',
                        viewId: 'view_1',
                        navigationGeneration: 6,
                        tier: 'injectedPage',
                        expression: 'document.title',
                        timeoutMs: 2_000,
                        objectGroupId: 'group_1',
                        diagnosticsInteractionEnabled: true,
                    },
                    onEvents: (events) => {
                        store = applyBrowserDiagnosticEvents(store, { events });
                    },
                    onRejectedMessage: (reasonCode) => {
                        rejectedMessages.push(reasonCode);
                    },
                }}
            />,
            {
                createNodeMock: (element) => (
                    (element as { type?: string }).type === 'iframe'
                        ? { contentWindow: iframeSource }
                        : null
                ),
            },
        );

        dispatchMessage(testWindow, {
            data: JSON.stringify(diagnosticBatch()),
            origin: 'https://preview.example.test',
            source: iframeSource,
        });

        expect(iframeSource.postMessage).toHaveBeenCalledWith(
            expect.stringContaining('"kind":"browser.diagnostics.evalRequest"'),
            'https://preview.example.test',
        );
        expect(selectBrowserDiagnosticsForView(store, {
            browserSessionId: 'browser_session_1',
            viewId: 'view_1',
        })).toMatchObject({
            status: 'available',
            eventCount: 1,
        });
        expect(rejectedMessages).toEqual([]);
    });

    it('fails closed when iframe diagnostics have no explicit postMessage target origin', async () => {
        const testWindow = installTestWindow();
        const onCollectorScriptReady = vi.fn();
        const onEvents = vi.fn();
        const onRejectedMessage = vi.fn();

        await renderScreen(
            <WebIframeEngine
                title="Preview"
                url="https://preview.example.test/app"
                sandbox="allow-scripts"
                testID="browser-web-frame"
                diagnostics={{
                    browserSessionId: 'browser_session_1',
                    viewId: 'view_1',
                    navigationGeneration: 6,
                    collectorId: 'collector_1',
                    nonce: 'nonce_1',
                    collectorVersion: '1.0.0',
                    sourceOrigin: 'https://preview.example.test',
                    onCollectorScriptReady,
                    onEvents,
                    onRejectedMessage,
                }}
            />,
        );

        dispatchMessage(testWindow, {
            data: JSON.stringify(diagnosticBatch()),
            origin: 'https://preview.example.test',
        });

        expect(onCollectorScriptReady).not.toHaveBeenCalled();
        expect(onEvents).not.toHaveBeenCalled();
        expect(onRejectedMessage).toHaveBeenCalledWith('unsupported_web_post_message');
    });

    it('applies local browser navigation commands to the iframe window', async () => {
        const historyBack = vi.fn();
        const historyForward = vi.fn();
        const reload = vi.fn();
        const stop = vi.fn();
        const iframeSource = {
            history: {
                back: historyBack,
                forward: historyForward,
            },
            location: {
                reload,
            },
            stop,
        } as unknown as WindowProxy;

        async function renderCommand(kind: 'goBack' | 'goForward' | 'reload' | 'stop'): Promise<void> {
            await renderScreen(
                <WebIframeEngine
                    title="Preview"
                    url="https://preview.example.test/app"
                    sandbox="allow-scripts"
                    testID={`browser-web-frame-${kind}`}
                    navigationCommand={{
                        commandId: `command_${kind}`,
                        kind,
                    }}
                />,
                {
                    createNodeMock: (element) => (
                        (element as { type?: string }).type === 'iframe'
                            ? { contentWindow: iframeSource }
                            : null
                    ),
                },
            );
        }

        await renderCommand('goBack');
        await renderCommand('goForward');
        await renderCommand('reload');
        await renderCommand('stop');

        expect(historyBack).toHaveBeenCalledTimes(1);
        expect(historyForward).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(stop).toHaveBeenCalledTimes(1);
    });

    it('permits wildcard bridge delivery only for an explicitly opaque Artifact guest', async () => {
        const testWindow = installTestWindow();
        const ordinaryFrame = { postMessage: vi.fn() } as unknown as WindowProxy;
        const opaqueArtifactFrame = { postMessage: vi.fn() } as unknown as WindowProxy;

        await renderScreen(
            <WebIframeEngine
                title="Ordinary guest"
                url="https://preview.example.test/ordinary"
                sandbox="allow-scripts"
                testID="ordinary-web-frame"
                webMessageBridge={{
                    targetOrigin: '*',
                    onMessage: () => ({ accepted: true }),
                }}
            />,
            {
                createNodeMock: (element) => (
                    (element as { type?: string }).type === 'iframe'
                        ? { contentWindow: ordinaryFrame }
                        : null
                ),
            },
        );
        await renderScreen(
            <WebIframeEngine
                title="Opaque Artifact guest"
                url="https://app.example.test/__happier/hosted-artifacts/hwa_token/index.html"
                sandbox="allow-scripts"
                testID="opaque-artifact-web-frame"
                webMessageBridge={{
                    targetOrigin: '*',
                    allowWildcardTargetOrigin: true,
                    onMessage: () => ({ accepted: true }),
                }}
            />,
            {
                createNodeMock: (element) => (
                    (element as { type?: string }).type === 'iframe'
                        ? { contentWindow: opaqueArtifactFrame }
                        : null
                ),
            },
        );

        await act(async () => {
            dispatchMessage(testWindow, {
                data: 'ordinary-message',
                origin: 'null',
                source: ordinaryFrame,
            });
            dispatchMessage(testWindow, {
                data: 'artifact-message',
                origin: 'null',
                source: opaqueArtifactFrame,
            });
            await Promise.resolve();
        });

        expect(ordinaryFrame.postMessage).not.toHaveBeenCalled();
        expect(opaqueArtifactFrame.postMessage).toHaveBeenCalledWith(
            { accepted: true },
            '*',
        );
    });

    it('binds an opaque bridge to the admitted document port before host delivery', async () => {
        const testWindow = installTestWindow();
        const iframeSource = { postMessage: vi.fn() } as unknown as WindowProxy;
        const documentChannel = createTestMessageChannel();
        const onMessage = vi.fn((event: MessageEvent) => ({ replyTo: event.data }));
        const onMessageAfterRerender = vi.fn((event: MessageEvent) => ({ replyTo: event.data }));
        let sendHostMessage: ((message: unknown) => void) | null = null;
        const attachHostMessages = (send: (message: unknown) => void) => {
            sendHostMessage = send;
            return () => { sendHostMessage = null; };
        };
        const webMessageBridge = (handleMessage: typeof onMessage) => ({
            targetOrigin: '*',
            allowWildcardTargetOrigin: true,
            exactDocumentChannel: true,
            onMessage: handleMessage,
            attachHostMessages,
        });

        const screen = await renderScreen(
            <WebIframeEngine
                title="Opaque Artifact guest"
                html="<p>admitted document</p>"
                sandbox="allow-scripts"
                testID="opaque-document-frame"
                webMessageBridge={webMessageBridge(onMessage)}
            />,
            { createNodeMock: (element) => element.type === 'iframe' ? { contentWindow: iframeSource } : null },
        );

        await act(async () => {
            dispatchMessage(testWindow, {
                data: 'ready',
                origin: 'null',
                source: iframeSource,
                ports: [documentChannel.port1],
            });
            await Promise.resolve();
        });
        expect(documentChannel.port1.postMessage).toHaveBeenCalledWith({ replyTo: 'ready' });

        await screen.update(
            <WebIframeEngine
                title="Opaque Artifact guest"
                html="<p>admitted document</p>"
                sandbox="allow-scripts"
                testID="opaque-document-frame"
                webMessageBridge={webMessageBridge(onMessageAfterRerender)}
            />,
        );

        await act(async () => {
            documentChannel.port2.postMessage('document request');
            sendHostMessage?.({ push: 'current document only' });
            dispatchMessage(testWindow, { data: 'replacement request', origin: 'null', source: iframeSource });
            await Promise.resolve();
        });

        expect(onMessage.mock.calls.map(([event]) => event.data)).toEqual(['ready']);
        expect(onMessageAfterRerender.mock.calls.map(([event]) => event.data)).toEqual(['document request']);
        expect(documentChannel.port1.postMessage).toHaveBeenCalledWith({ push: 'current document only' });
        expect(iframeSource.postMessage).not.toHaveBeenCalled();
    });

    it('retires an exact-document port when inline document authority changes and requires a fresh handshake', async () => {
        const testWindow = installTestWindow();
        const iframeSource = { postMessage: vi.fn() } as unknown as WindowProxy;
        const incumbentChannel = createTestMessageChannel();
        const replacementChannel = createTestMessageChannel();
        const onMessage = vi.fn((event: MessageEvent) => ({ replyTo: event.data }));
        let sendHostMessage: ((message: unknown) => void) | null = null;
        const webMessageBridge = {
            targetOrigin: '*',
            allowWildcardTargetOrigin: true,
            exactDocumentChannel: true,
            onMessage,
            attachHostMessages: (send: (message: unknown) => void) => {
                sendHostMessage = send;
                return () => { sendHostMessage = null; };
            },
        };
        const screen = await renderScreen(
            <WebIframeEngine
                title="Opaque Artifact guest"
                html="<p>incumbent document</p>"
                sandbox="allow-scripts"
                testID="opaque-document-frame"
                webMessageBridge={webMessageBridge}
            />,
            { createNodeMock: (element) => element.type === 'iframe' ? { contentWindow: iframeSource } : null },
        );

        await act(async () => {
            dispatchMessage(testWindow, {
                data: 'incumbent ready',
                origin: 'null',
                source: iframeSource,
                ports: [incumbentChannel.port1],
            });
            await Promise.resolve();
        });
        expect(onMessage.mock.calls.map(([event]) => event.data)).toEqual(['incumbent ready']);

        incumbentChannel.port1PostMessage.mockClear();
        await screen.update(
            <WebIframeEngine
                title="Opaque Artifact guest"
                html="<p>replacement document</p>"
                sandbox="allow-scripts"
                testID="opaque-document-frame"
                webMessageBridge={webMessageBridge}
            />,
        );

        await act(async () => {
            incumbentChannel.port2.postMessage('retired document request');
            sendHostMessage?.({ push: 'before replacement handshake' });
            dispatchMessage(testWindow, {
                data: 'replacement without port',
                origin: 'null',
                source: iframeSource,
            });
            await Promise.resolve();
        });
        expect(incumbentChannel.port1Close).toHaveBeenCalledOnce();
        expect(incumbentChannel.port1PostMessage).not.toHaveBeenCalled();
        expect(replacementChannel.port1PostMessage).not.toHaveBeenCalled();
        expect(onMessage.mock.calls.map(([event]) => event.data)).toEqual(['incumbent ready']);

        await act(async () => {
            dispatchMessage(testWindow, {
                data: 'replacement ready',
                origin: 'null',
                source: iframeSource,
                ports: [replacementChannel.port1],
            });
            replacementChannel.port2.postMessage('replacement request');
            sendHostMessage?.({ push: 'replacement current' });
            await Promise.resolve();
        });
        expect(onMessage.mock.calls.map(([event]) => event.data)).toEqual([
            'incumbent ready',
            'replacement ready',
            'replacement request',
        ]);
        expect(replacementChannel.port1PostMessage).toHaveBeenCalledWith({ replyTo: 'replacement ready' });
        expect(replacementChannel.port1PostMessage).toHaveBeenCalledWith({ replyTo: 'replacement request' });
        expect(replacementChannel.port1PostMessage).toHaveBeenCalledWith({ push: 'replacement current' });
        expect(iframeSource.postMessage).not.toHaveBeenCalled();
    });

    it('delivers the attachment owner terminal push through an ordinary-origin frame before teardown', async () => {
        installTestWindow();
        const iframeSource = { postMessage: vi.fn() } as unknown as WindowProxy;
        let detachCount = 0;
        const screen = await renderScreen(
            <WebIframeEngine
                title="Ordinary guest"
                url="https://guest.example.test/app"
                sandbox="allow-scripts"
                testID="ordinary-web-frame"
                webMessageBridge={{
                    targetOrigin: 'https://guest.example.test',
                    onMessage: () => undefined,
                    attachHostMessages: (send) => () => {
                        detachCount += 1;
                        send({ terminal: 'disconnected' });
                    },
                }}
            />,
            { createNodeMock: (element) => element.type === 'iframe' ? { contentWindow: iframeSource } : null },
        );

        await screen.unmount();

        // The bridge owner's one terminal packet must reach the incumbent guest.
        // Retiring the delivery primitive first drops it silently.
        expect(iframeSource.postMessage).toHaveBeenCalledWith(
            { terminal: 'disconnected' },
            'https://guest.example.test',
        );
        expect(detachCount).toBe(1);
    });

    it('delivers the attachment owner terminal push over the incumbent document port before it is closed', async () => {
        const testWindow = installTestWindow();
        const iframeSource = { postMessage: vi.fn() } as unknown as WindowProxy;
        const incumbentChannel = createTestMessageChannel();
        const replacementChannel = createTestMessageChannel();
        let detachCount = 0;
        const bridge = (terminal: string) => ({
            targetOrigin: '*',
            allowWildcardTargetOrigin: true,
            exactDocumentChannel: true,
            onMessage: () => undefined,
            attachHostMessages: (send: (message: unknown) => void) => () => {
                detachCount += 1;
                send({ terminal });
            },
        });

        const screen = await renderScreen(
            <WebIframeEngine
                title="Opaque Artifact guest"
                html="<p>incumbent document</p>"
                sandbox="allow-scripts"
                testID="opaque-document-frame"
                webMessageBridge={bridge('incumbent-disconnected')}
            />,
            { createNodeMock: (element) => element.type === 'iframe' ? { contentWindow: iframeSource } : null },
        );
        await act(async () => {
            dispatchMessage(testWindow, {
                data: 'incumbent ready',
                origin: 'null',
                source: iframeSource,
                ports: [incumbentChannel.port1],
            });
            await Promise.resolve();
        });

        // A replacement document retires the incumbent transport. The terminal
        // packet must land on the incumbent port while it is still open.
        await screen.update(
            <WebIframeEngine
                title="Opaque Artifact guest"
                html="<p>replacement document</p>"
                sandbox="allow-scripts"
                testID="opaque-document-frame"
                webMessageBridge={bridge('replacement-disconnected')}
            />,
        );
        expect(incumbentChannel.port1PostMessage).toHaveBeenCalledWith({ terminal: 'incumbent-disconnected' });
        expect(incumbentChannel.port1Close).toHaveBeenCalledOnce();
        expect(detachCount).toBe(1);

        await act(async () => {
            dispatchMessage(testWindow, {
                data: 'replacement ready',
                origin: 'null',
                source: iframeSource,
                ports: [replacementChannel.port1],
            });
            await Promise.resolve();
        });
        await screen.unmount();

        // Unmount is the same ordered retirement, and each attachment is
        // disposed exactly once.
        expect(replacementChannel.port1PostMessage).toHaveBeenCalledWith({ terminal: 'replacement-disconnected' });
        expect(detachCount).toBe(2);
        expect(incumbentChannel.port1PostMessage).not.toHaveBeenCalledWith({ terminal: 'replacement-disconnected' });
        expect(iframeSource.postMessage).not.toHaveBeenCalled();
    });

    it('issues one host-owned transient activation only to the exact focused iframe', async () => {
        const testWindow = installTestWindow();
        const iframeSource = { postMessage: vi.fn() } as unknown as WindowProxy;
        const iframeElement = { contentWindow: iframeSource } as unknown as HTMLIFrameElement;
        const otherElement = {} as Element;
        const userActivation = { isActive: true };
        let activeElement: Element | null = otherElement;
        vi.stubGlobal('navigator', { userActivation });
        vi.stubGlobal('document', {
            get activeElement() { return activeElement; },
        });
        const receipts: Array<Readonly<{ consumeTransientActivation(): boolean }>> = [];

        await renderScreen(
            <WebIframeEngine
                title="Inline"
                html="<button>Send</button>"
                sandbox="allow-scripts"
                testID="inline-frame"
                webMessageBridge={{
                    targetOrigin: '*',
                    allowWildcardTargetOrigin: true,
                    onMessage: (...args: unknown[]) => {
                        receipts.push(args[1] as Readonly<{ consumeTransientActivation(): boolean }>);
                    },
                }}
            />,
            { createNodeMock: (element) => element.type === 'iframe' ? iframeElement : null },
        );

        dispatchMessage(testWindow, { data: 'wrong-frame', origin: 'null', source: iframeSource });
        expect(receipts.at(-1)?.consumeTransientActivation()).toBe(false);

        activeElement = iframeElement;
        dispatchMessage(testWindow, { data: 'genuine', origin: 'null', source: iframeSource });
        expect(receipts.at(-1)?.consumeTransientActivation()).toBe(true);
        expect(receipts.at(-1)?.consumeTransientActivation()).toBe(false);

        dispatchMessage(testWindow, { data: 'replay', origin: 'null', source: iframeSource });
        expect(receipts.at(-1)?.consumeTransientActivation()).toBe(false);

        userActivation.isActive = false;
        dispatchMessage(testWindow, { data: 'delayed', origin: 'null', source: iframeSource });
        expect(receipts.at(-1)?.consumeTransientActivation()).toBe(false);
        userActivation.isActive = true;
        dispatchMessage(testWindow, { data: 'next-genuine-activation', origin: 'null', source: iframeSource });
        expect(receipts.at(-1)?.consumeTransientActivation()).toBe(true);
    });

    it('posts eval requests into the iframe and routes nonce-bound eval results back to diagnostics', async () => {
        const testWindow = installTestWindow();
        const iframeSource = { postMessage: vi.fn() } as unknown as WindowProxy;
        const onEvalResult = vi.fn();
        const onPropertiesResult = vi.fn();
        const onReleaseObjectGroupResult = vi.fn();
        const onElementPickerResult = vi.fn();

        await renderScreen(
            <WebIframeEngine
                title="Preview"
                url="https://preview.example.test/app"
                sandbox="allow-scripts"
                testID="browser-web-frame"
                diagnostics={{
                    browserSessionId: 'browser_session_1',
                    viewId: 'view_1',
                    navigationGeneration: 6,
                    collectorId: 'collector_1',
                    nonce: 'nonce_1',
                    collectorVersion: '1.0.0',
                    sourceOrigin: 'https://preview.example.test',
                    webPostMessageTargetOrigin: 'https://app.example.test',
                    evalRequest: {
                        v: 1,
                        evalRequestId: 'eval_1',
                        viewId: 'view_1',
                        navigationGeneration: 6,
                        tier: 'injectedPage',
                        expression: '({ ok: true })',
                        timeoutMs: 2_000,
                        objectGroupId: 'group_1',
                        diagnosticsInteractionEnabled: true,
                    },
                    getPropertiesRequest: {
                        v: 1,
                        propertyRequestId: 'props_1',
                        viewId: 'view_1',
                        navigationGeneration: 6,
                        tier: 'injectedPage',
                        objectId: 'obj_1',
                        objectGroupId: 'group_1',
                        diagnosticsInteractionEnabled: true,
                    },
                    releaseObjectGroupRequest: {
                        v: 1,
                        releaseRequestId: 'release_1',
                        viewId: 'view_1',
                        navigationGeneration: 6,
                        tier: 'injectedPage',
                        objectGroupId: 'group_1',
                        diagnosticsInteractionEnabled: true,
                    },
                    elementPickerRequest: {
                        v: 1,
                        pickerRequestId: 'picker_1',
                        viewId: 'view_1',
                        navigationGeneration: 6,
                        tier: 'injectedPage',
                        action: 'start',
                        diagnosticsInteractionEnabled: true,
                    },
                    onEvents: vi.fn(),
                    onEvalResult,
                    onPropertiesResult,
                    onReleaseObjectGroupResult,
                    onElementPickerResult,
                }}
            />,
            {
                createNodeMock: (element) => (
                    (element as { type?: string }).type === 'iframe'
                        ? { contentWindow: iframeSource }
                        : null
                ),
            },
        );

        expect(iframeSource.postMessage).toHaveBeenCalledWith(
            expect.stringContaining('"kind":"browser.diagnostics.evalRequest"'),
            'https://preview.example.test',
        );
        expect(iframeSource.postMessage).toHaveBeenCalledWith(
            expect.stringContaining('"kind":"browser.diagnostics.getPropertiesRequest"'),
            'https://preview.example.test',
        );
        expect(iframeSource.postMessage).toHaveBeenCalledWith(
            expect.stringContaining('"kind":"browser.diagnostics.releaseObjectGroupRequest"'),
            'https://preview.example.test',
        );
        expect(iframeSource.postMessage).toHaveBeenCalledWith(
            expect.stringContaining('"kind":"browser.diagnostics.elementPickerRequest"'),
            'https://preview.example.test',
        );

        dispatchMessage(testWindow, {
            data: JSON.stringify({
                v: 1,
                kind: 'browser.diagnostics.evalResult',
                browserSessionId: 'browser_session_1',
                viewId: 'view_1',
                navigationGeneration: 6,
                collector: {
                    collectorId: 'collector_1',
                    nonce: 'nonce_1',
                    version: '1.0.0',
                },
                result: {
                    v: 1,
                    evalRequestId: 'eval_1',
                    viewId: 'view_1',
                    navigationGeneration: 6,
                    status: 'completed',
                    tier: 'injectedPage',
                    audited: true,
                    result: {
                        type: 'object',
                        objectId: 'obj_1',
                        className: 'Object',
                        description: 'Object',
                    },
                },
            }),
            origin: 'https://preview.example.test',
            source: iframeSource,
        });

        expect(onEvalResult).toHaveBeenCalledWith(expect.objectContaining({
            evalRequestId: 'eval_1',
            status: 'completed',
        }));

        dispatchMessage(testWindow, {
            data: JSON.stringify({
                v: 1,
                kind: 'browser.diagnostics.getPropertiesResult',
                browserSessionId: 'browser_session_1',
                viewId: 'view_1',
                navigationGeneration: 6,
                collector: {
                    collectorId: 'collector_1',
                    nonce: 'nonce_1',
                    version: '1.0.0',
                },
                result: {
                    v: 1,
                    propertyRequestId: 'props_1',
                    viewId: 'view_1',
                    navigationGeneration: 6,
                    tier: 'injectedPage',
                    status: 'completed',
                    audited: true,
                    objectId: 'obj_1',
                    properties: [{ name: 'ok', value: { type: 'boolean', value: true }, enumerable: true }],
                },
            }),
            origin: 'https://preview.example.test',
            source: iframeSource,
        });
        dispatchMessage(testWindow, {
            data: JSON.stringify({
                v: 1,
                kind: 'browser.diagnostics.releaseObjectGroupResult',
                browserSessionId: 'browser_session_1',
                viewId: 'view_1',
                navigationGeneration: 6,
                collector: {
                    collectorId: 'collector_1',
                    nonce: 'nonce_1',
                    version: '1.0.0',
                },
                result: {
                    v: 1,
                    releaseRequestId: 'release_1',
                    viewId: 'view_1',
                    navigationGeneration: 6,
                    tier: 'injectedPage',
                    status: 'completed',
                    audited: true,
                    objectGroupId: 'group_1',
                },
            }),
            origin: 'https://preview.example.test',
            source: iframeSource,
        });
        dispatchMessage(testWindow, {
            data: JSON.stringify({
                v: 1,
                kind: 'browser.diagnostics.elementPickerResult',
                browserSessionId: 'browser_session_1',
                viewId: 'view_1',
                navigationGeneration: 6,
                collector: {
                    collectorId: 'collector_1',
                    nonce: 'nonce_1',
                    version: '1.0.0',
                },
                result: {
                    v: 1,
                    pickerRequestId: 'picker_1',
                    viewId: 'view_1',
                    navigationGeneration: 6,
                    tier: 'injectedPage',
                    status: 'selected',
                    audited: true,
                    backendNodeRef: 'node_1',
                    selectorPath: 'html > body > main:nth-of-type(1)',
                    rect: { x: 10, y: 20, width: 300, height: 40 },
                    accessibleName: 'Run',
                },
            }),
            origin: 'https://preview.example.test',
            source: iframeSource,
        });

        expect(onPropertiesResult).toHaveBeenCalledWith(expect.objectContaining({
            propertyRequestId: 'props_1',
            properties: [expect.objectContaining({ name: 'ok' })],
        }));
        expect(onReleaseObjectGroupResult).toHaveBeenCalledWith(expect.objectContaining({
            releaseRequestId: 'release_1',
            objectGroupId: 'group_1',
        }));
        expect(onElementPickerResult).toHaveBeenCalledWith(expect.objectContaining({
            pickerRequestId: 'picker_1',
            backendNodeRef: 'node_1',
            selectorPath: 'html > body > main:nth-of-type(1)',
        }));
    });
});

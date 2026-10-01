import * as React from 'react';
import { View } from 'react-native';

import { browserFrameStyles } from '../styles';
import type {
    BrowserAutomationEngineBridgeConfig,
    BrowserDiagnosticsEngineBridgeConfig,
    BrowserFrameMessageReceipt,
    BrowserFrameNavigationCommand,
    BrowserWebFrameMessageBridgeConfig,
    WebIframeSource,
} from '../types';
import {
    buildInjectedBrowserDiagnosticsElementPickerCommandMessage,
    buildInjectedBrowserDiagnosticsEvalCommandMessage,
    buildInjectedBrowserDiagnosticsGetPropertiesCommandMessage,
    buildInjectedBrowserDiagnosticsReleaseObjectGroupCommandMessage,
    buildInjectedBrowserDiagnosticsScript,
    parseInjectedBrowserDiagnosticsMessage,
} from '../../adapters/diagnostics';
import { createWebIframeAutomationOwner } from '../../adapters/automation';

const iframeStyle: React.CSSProperties = {
    border: 0,
    display: 'block',
    height: '100%',
    width: '100%',
};

function normalizePostMessageOrigin(origin: string | undefined): string | null {
    if (!origin) {
        return null;
    }
    try {
        return new URL(origin).origin;
    } catch {
        return null;
    }
}

function isPermittedPostMessageTargetOrigin(
    origin: string | undefined,
    allowWildcard: boolean | undefined,
): origin is string {
    return origin === '*'
        ? allowWildcard === true
        : normalizePostMessageOrigin(origin) !== null;
}

function applyWebIframeNavigationCommand(
    iframe: HTMLIFrameElement | null,
    command: BrowserFrameNavigationCommand | undefined,
): void {
    if (!iframe || !command) return;
    const targetWindow = iframe.contentWindow;
    if (!targetWindow) return;

    try {
        switch (command.kind) {
            case 'goBack':
                targetWindow.history.back();
                break;
            case 'goForward':
                targetWindow.history.forward();
                break;
            case 'reload':
                targetWindow.location.reload();
                break;
            case 'stop':
                targetWindow.stop();
                break;
        }
    } catch {
        // Cross-origin and sandboxed frames can reject direct navigation control.
    }
}

export function WebIframeEngine(props: Readonly<{
    title: string;
    sandbox: string;
    testID: string;
    navigationKey?: string;
    navigationCommand?: BrowserFrameNavigationCommand;
    referrerPolicy?: 'no-referrer';
    csp?: string;
    onLoad?: () => void;
    onError?: () => void;
    revokeOnUnexpectedNavigation?: boolean;
    onUnexpectedNavigation?: () => void;
    diagnostics?: BrowserDiagnosticsEngineBridgeConfig;
    automation?: BrowserAutomationEngineBridgeConfig;
    webMessageBridge?: BrowserWebFrameMessageBridgeConfig;
}> & WebIframeSource): React.ReactElement {
    const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
    const hasLoadedCurrentNavigationRef = React.useRef(false);
    const [loadedDocumentRevision, setLoadedDocumentRevision] = React.useState(0);
    const diagnosticsRef = React.useRef(props.diagnostics);
    const automationRef = React.useRef(props.automation);
    diagnosticsRef.current = props.diagnostics;
    automationRef.current = props.automation;
    const bridgeDocumentRetiredRef = React.useRef(false);
    const bridgeSendRef = React.useRef<((message: unknown) => void) | null>(null);
    const webMessageBridgeRef = React.useRef(props.webMessageBridge);
    webMessageBridgeRef.current = props.webMessageBridge;
    const bridgeEnabled = props.webMessageBridge !== undefined;
    const bridgeExactDocumentChannel = props.webMessageBridge?.exactDocumentChannel === true;
    const bridgeTargetOrigin = props.webMessageBridge?.targetOrigin;
    const bridgeAllowsWildcardTargetOrigin = props.webMessageBridge?.allowWildcardTargetOrigin === true;
    const bridgeAttachHostMessages = props.webMessageBridge?.attachHostMessages;
    const collectorScript = React.useMemo(() => {
        const diagnostics = props.diagnostics;
        const targetOrigin = normalizePostMessageOrigin(diagnostics?.webPostMessageTargetOrigin);
        if (!diagnostics || !targetOrigin) return null;
        return buildInjectedBrowserDiagnosticsScript({
            browserSessionId: diagnostics.browserSessionId,
            viewId: diagnostics.viewId,
            navigationGeneration: diagnostics.navigationGeneration,
            collectorId: diagnostics.collectorId,
            nonce: diagnostics.nonce,
            version: diagnostics.collectorVersion,
            webPostMessageTargetOrigin: targetOrigin,
            ownerConsoleValueCapture: diagnostics.consoleValueCapture === true,
            ownerDiagnosticsValueCapture: diagnostics.valueCapture === true,
        });
    }, [
        props.diagnostics?.browserSessionId,
        props.diagnostics?.viewId,
        props.diagnostics?.navigationGeneration,
        props.diagnostics?.collectorId,
        props.diagnostics?.nonce,
        props.diagnostics?.collectorVersion,
        props.diagnostics?.webPostMessageTargetOrigin,
        props.diagnostics?.consoleValueCapture,
        props.diagnostics?.valueCapture,
    ]);

    React.useLayoutEffect(() => {
        hasLoadedCurrentNavigationRef.current = false;
        bridgeDocumentRetiredRef.current = false;
    }, [props.navigationKey, props.url, props.html]);

    React.useEffect(() => {
        const diagnostics = props.diagnostics;
        if (!diagnostics) return;

        const sourceOrigin = normalizePostMessageOrigin(diagnostics.sourceOrigin);
        const webPostMessageTargetOrigin = normalizePostMessageOrigin(diagnostics.webPostMessageTargetOrigin);

        if (!webPostMessageTargetOrigin) {
            diagnostics.onRejectedMessage?.('unsupported_web_post_message');
            return;
        }

        if (collectorScript) diagnostics.onCollectorScriptReady?.(collectorScript);

        if (typeof window === 'undefined') return;

        const listener = (event: MessageEvent) => {
            if (!sourceOrigin || event.origin !== sourceOrigin) {
                diagnostics.onRejectedMessage?.('origin_mismatch');
                return;
            }
            const expectedSource = iframeRef.current?.contentWindow ?? null;
            if (expectedSource && event.source !== expectedSource) {
                diagnostics.onRejectedMessage?.('source_mismatch');
                return;
            }
            if (typeof event.data !== 'string') {
                diagnostics.onRejectedMessage?.('schema_invalid');
                return;
            }

            const parsed = parseInjectedBrowserDiagnosticsMessage(event.data, {
                browserSessionId: diagnostics.browserSessionId,
                viewId: diagnostics.viewId,
                navigationGeneration: diagnostics.navigationGeneration,
                collectorId: diagnostics.collectorId,
                nonce: diagnostics.nonce,
            }, {
                consoleValueCapture: diagnostics.consoleValueCapture === true,
                valueCapture: diagnostics.valueCapture === true,
            });
            if (parsed.ok) {
                if (parsed.events) {
                    diagnostics.onEvents(parsed.events);
                    return;
                }
                if (parsed.evalResult) {
                    diagnostics.onEvalResult?.(parsed.evalResult);
                    return;
                }
                if (parsed.propertiesResult) {
                    diagnostics.onPropertiesResult?.(parsed.propertiesResult);
                    return;
                }
                if (parsed.releaseResult) {
                    diagnostics.onReleaseObjectGroupResult?.(parsed.releaseResult);
                    return;
                }
                if (parsed.elementPickerResult) {
                    diagnostics.onElementPickerResult?.(parsed.elementPickerResult);
                    return;
                }
                return;
            }
            diagnostics.onRejectedMessage?.(parsed.reasonCode);
        };

        window.addEventListener('message', listener);
        return () => {
            window.removeEventListener('message', listener);
        };
    }, [props.diagnostics, collectorScript]);

    // Callback/request changes do not reinstall the collector or retire in-flight actions.
    const automationActionsKey = JSON.stringify(props.automation?.supportedActions ?? []);
    React.useEffect(() => {
        if (!hasLoadedCurrentNavigationRef.current) return;
        if (typeof window === 'undefined') return;
        const diagnostics = diagnosticsRef.current;
        const automation = automationRef.current;
        if (!diagnostics || !collectorScript) {
            automation?.onRegistrationRejected?.('runtime_unavailable');
            return;
        }
        const sourceOrigin = normalizePostMessageOrigin(diagnostics.sourceOrigin);
        const targetWindow = iframeRef.current?.contentWindow ?? null;
        // An opaque or cross-origin guest cannot be injected by its parent. Keep its isolation;
        // a contentWindow/postMessage primitive alone is not evidence of a collector.
        const sandboxTokens = props.sandbox.split(/\s+/);
        if (!sourceOrigin || !targetWindow || !sandboxTokens.includes('allow-scripts') || !sandboxTokens.includes('allow-same-origin')) {
            automation?.onRegistrationRejected?.('cross_origin_frame_unavailable');
            return;
        }
        let targetDocument: Document;
        let previousRuntime: unknown;
        try {
            targetDocument = targetWindow.document;
            if (targetWindow.location.origin !== sourceOrigin) throw new Error('origin_mismatch');
            previousRuntime = Reflect.get(targetWindow, '__happierBrowserRuntime');
        } catch {
            automation?.onRegistrationRejected?.('cross_origin_frame_unavailable');
            return;
        }
        let runtime: unknown;
        try {
            const script = targetDocument.createElement('script');
            script.textContent = collectorScript;
            try {
                (targetDocument.head ?? targetDocument.documentElement).appendChild(script);
            } finally {
                script.remove();
            }
            runtime = Reflect.get(targetWindow, '__happierBrowserRuntime');
        } catch {
            automation?.onRegistrationRejected?.('runtime_unavailable');
            return;
        }
        if (!runtime || runtime === previousRuntime || typeof runtime !== 'object'
            || !('browserSessionId' in runtime) || runtime.browserSessionId !== diagnostics.browserSessionId
            || !('viewId' in runtime) || runtime.viewId !== diagnostics.viewId
            || !('navigationGeneration' in runtime) || runtime.navigationGeneration !== diagnostics.navigationGeneration
            || !('teardown' in runtime) || typeof runtime.teardown !== 'function'
            || !('modules' in runtime) || !runtime.modules || typeof runtime.modules !== 'object'
            || !('automation' in runtime.modules) || !runtime.modules.automation || typeof runtime.modules.automation !== 'object'
            || !('execute' in runtime.modules.automation) || typeof runtime.modules.automation.execute !== 'function') {
            automation?.onRegistrationRejected?.('runtime_unavailable');
            return;
        }
        const teardownRuntime = runtime.teardown;
        const retireRuntime = () => {
            try {
                if (Reflect.get(targetWindow, '__happierBrowserRuntime') === runtime) teardownRuntime();
            } catch {
                // Navigating away may already have destroyed the guest realm.
            }
        };
        if (!automation || automation.supportedActions.length === 0) return retireRuntime;
        if (automation.browserSessionId !== diagnostics.browserSessionId || automation.viewId !== diagnostics.viewId
            || automation.navigationGeneration !== diagnostics.navigationGeneration
            || automation.collectorId !== diagnostics.collectorId || automation.nonce !== diagnostics.nonce
            || normalizePostMessageOrigin(automation.sourceOrigin) !== sourceOrigin) {
            automation.onRegistrationRejected?.('runtime_unavailable');
            return retireRuntime;
        }

        const ownerId = [
            'browser_automation_owner',
            automation.browserSessionId,
            automation.viewId,
            automation.navigationGeneration,
            'webIframe',
        ].join(':');
        const owner = createWebIframeAutomationOwner({
            ownerId,
            browserSessionId: automation.browserSessionId,
            viewId: automation.viewId,
            navigationGeneration: automation.navigationGeneration,
            adapterKind: automation.adapterKind,
            collectorId: automation.collectorId,
            nonce: automation.nonce,
            capabilityVersion: automation.capabilityVersion,
            supportedActions: automation.supportedActions,
            targetWindow: {
                postMessage(message, origin) {
                    try {
                        if (targetWindow.document !== targetDocument || targetWindow.location.origin !== sourceOrigin) {
                            throw new Error('cross_origin_frame_unavailable');
                        }
                    } catch {
                        throw new Error('cross_origin_frame_unavailable');
                    }
                    targetWindow.postMessage(message, origin);
                },
            },
            targetOrigin: sourceOrigin,
            subscribeToMessages(listener) {
                const handler = (event: MessageEvent) => {
                    if (event.origin !== sourceOrigin) return;
                    if (event.source !== targetWindow) return;
                    if (typeof event.data !== 'string') {
                        automationRef.current?.onRejectedMessage?.('schema_invalid');
                        return;
                    }
                    listener(event.data);
                };
                window.addEventListener('message', handler);
                return () => {
                    window.removeEventListener('message', handler);
                };
            },
            nowMs: automation.nowMs ?? Date.now,
        });
        const registration = automation.controlService.registerOwner(owner);
        if (!registration.ok) {
            automationRef.current?.onRegistrationRejected?.(registration.reasonCode);
            return retireRuntime;
        }

        return () => {
            automation.controlService.unregisterOwner({
                ownerId,
                reasonCode: 'owner_disconnected',
            });
            retireRuntime();
        };
    }, [
        collectorScript,
        loadedDocumentRevision,
        props.navigationKey,
        props.url,
        props.html,
        props.sandbox,
        props.diagnostics?.sourceOrigin,
        props.automation?.browserSessionId,
        props.automation?.viewId,
        props.automation?.navigationGeneration,
        props.automation?.collectorId,
        props.automation?.nonce,
        props.automation?.capabilityVersion,
        props.automation?.adapterKind,
        props.automation?.sourceOrigin,
        props.automation?.controlService,
        props.automation?.nowMs,
        automationActionsKey,
    ]);

    React.useEffect(() => {
        const diagnostics = props.diagnostics;
        const evalRequest = diagnostics?.evalRequest;
        if (!diagnostics || !evalRequest) return;

        const sourceOrigin = normalizePostMessageOrigin(diagnostics.sourceOrigin);
        if (!sourceOrigin) {
            diagnostics.onRejectedMessage?.('unsupported_web_post_message');
            return;
        }

        const targetWindow = iframeRef.current?.contentWindow;
        if (!targetWindow) return;

        const command = buildInjectedBrowserDiagnosticsEvalCommandMessage({
            browserSessionId: diagnostics.browserSessionId,
            collectorId: diagnostics.collectorId,
            nonce: diagnostics.nonce,
            version: diagnostics.collectorVersion,
            request: evalRequest,
        });
        targetWindow.postMessage(JSON.stringify(command), sourceOrigin);
    }, [props.diagnostics]);

    React.useEffect(() => {
        const diagnostics = props.diagnostics;
        const getPropertiesRequest = diagnostics?.getPropertiesRequest;
        const releaseObjectGroupRequest = diagnostics?.releaseObjectGroupRequest;
        const elementPickerRequest = diagnostics?.elementPickerRequest;
        if (!diagnostics || (!getPropertiesRequest && !releaseObjectGroupRequest && !elementPickerRequest)) return;

        const sourceOrigin = normalizePostMessageOrigin(diagnostics.sourceOrigin);
        if (!sourceOrigin) {
            diagnostics.onRejectedMessage?.('unsupported_web_post_message');
            return;
        }

        const targetWindow = iframeRef.current?.contentWindow;
        if (!targetWindow) return;

        if (getPropertiesRequest) {
            targetWindow.postMessage(JSON.stringify(buildInjectedBrowserDiagnosticsGetPropertiesCommandMessage({
                browserSessionId: diagnostics.browserSessionId,
                collectorId: diagnostics.collectorId,
                nonce: diagnostics.nonce,
                version: diagnostics.collectorVersion,
                request: getPropertiesRequest,
            })), sourceOrigin);
        }

        if (releaseObjectGroupRequest) {
            targetWindow.postMessage(JSON.stringify(buildInjectedBrowserDiagnosticsReleaseObjectGroupCommandMessage({
                browserSessionId: diagnostics.browserSessionId,
                collectorId: diagnostics.collectorId,
                nonce: diagnostics.nonce,
                version: diagnostics.collectorVersion,
                request: releaseObjectGroupRequest,
            })), sourceOrigin);
        }

        if (elementPickerRequest) {
            targetWindow.postMessage(JSON.stringify(buildInjectedBrowserDiagnosticsElementPickerCommandMessage({
                browserSessionId: diagnostics.browserSessionId,
                collectorId: diagnostics.collectorId,
                nonce: diagnostics.nonce,
                version: diagnostics.collectorVersion,
                request: elementPickerRequest,
            })), sourceOrigin);
        }
    }, [props.diagnostics]);

    // EU-8: the host->frame push direction. The engine owns only the delivery
    // primitive and lends it to the bridge owner while the frame is mounted.
    // Opaque hosted documents use their transferred, document-bound port;
    // ordinary frames use the admitted exact target origin. A missing or
    // inadmissible transport fails closed instead of broadcasting host facts.
    //
    // This attachment and the transport below are ONE ordered lifecycle, and
    // the attachment is declared first on purpose. React retires layout effects
    // in declaration order, so the bridge owner's disposer runs while `active`,
    // the installed `send` and the incumbent MessagePort are all still live —
    // which is the only moment its one terminal packet can still reach the
    // incumbent guest. It must also be a LAYOUT effect: passive cleanup happens
    // after React has cleared `iframeRef`, which is already too late to address
    // an ordinary-origin document.
    React.useLayoutEffect(() => {
        if (!bridgeAttachHostMessages || !isPermittedPostMessageTargetOrigin(bridgeTargetOrigin, bridgeAllowsWildcardTargetOrigin)) return;
        return bridgeAttachHostMessages((message: unknown) => {
            bridgeSendRef.current?.(message);
        });
    }, [
        bridgeAttachHostMessages,
        bridgeAllowsWildcardTargetOrigin,
        bridgeTargetOrigin,
    ]);

    React.useLayoutEffect(() => {
        if (!bridgeEnabled) return;
        if (typeof window === 'undefined') return;
        let active = true;
        let documentPort: MessagePort | null = null;
        let transientActivationConsumed = false;

        const createMessageReceipt = (): BrowserFrameMessageReceipt => {
            const iframe = iframeRef.current;
            const hostNavigator = Reflect.get(globalThis, 'navigator');
            const userActivation = hostNavigator && typeof hostNavigator === 'object'
                ? Reflect.get(hostNavigator, 'userActivation')
                : null;
            const isActive = Boolean(
                userActivation
                && typeof userActivation === 'object'
                && Reflect.get(userActivation, 'isActive') === true,
            );
            const hostDocument = Reflect.get(globalThis, 'document');
            const exactFrameFocused = Boolean(
                iframe
                && hostDocument
                && typeof hostDocument === 'object'
                && Reflect.get(hostDocument, 'activeElement') === iframe,
            );
            // Browser activation has no author-readable host token. Observe its
            // inactive transition to arm the next epoch without a timer.
            if (!isActive) transientActivationConsumed = false;
            let receiptConsumed = false;
            return Object.freeze({
                consumeTransientActivation(): boolean {
                    if (!isActive || !exactFrameFocused || receiptConsumed || transientActivationConsumed) {
                        return false;
                    }
                    receiptConsumed = true;
                    transientActivationConsumed = true;
                    return true;
                },
            });
        };

        const send = (message: unknown): void => {
            if (!active || bridgeDocumentRetiredRef.current) return;
            if (documentPort) {
                documentPort.postMessage(message);
                return;
            }
            if (bridgeExactDocumentChannel) return;
            if (!isPermittedPostMessageTargetOrigin(bridgeTargetOrigin, bridgeAllowsWildcardTargetOrigin)) return;
            iframeRef.current?.contentWindow?.postMessage(message, bridgeTargetOrigin);
        };
        bridgeSendRef.current = send;

        const dispatch = (data: unknown, origin: string, expectedSource: WindowProxy): void => {
            const event = { data, origin, source: expectedSource } as MessageEvent;
            const receipt = createMessageReceipt();
            const bridge = webMessageBridgeRef.current;
            if (!bridge) return;
            Promise.resolve(bridge.onMessage(event, receipt)).then((response) => {
                if (!active || bridgeDocumentRetiredRef.current || iframeRef.current?.contentWindow !== expectedSource) return;
                if (response === undefined || response === null) return;
                send(response);
            }).catch(() => undefined);
        };

        const listener = (event: MessageEvent) => {
            const expectedSource = iframeRef.current?.contentWindow ?? null;
            if (!active || bridgeDocumentRetiredRef.current || !expectedSource || event.source !== expectedSource) return;
            if (bridgeExactDocumentChannel) {
                if (documentPort) return;
                const transferredPort = event.ports?.[0];
                if (!transferredPort) return;
                documentPort = transferredPort;
                documentPort.onmessage = (portEvent) => {
                    if (!active || bridgeDocumentRetiredRef.current) return;
                    dispatch(portEvent.data, event.origin, expectedSource);
                };
                documentPort.start();
            }
            dispatch(event.data, event.origin, expectedSource);
        };

        window.addEventListener('message', listener);
        return () => {
            active = false;
            if (bridgeSendRef.current === send) bridgeSendRef.current = null;
            documentPort?.close();
            documentPort = null;
            window.removeEventListener('message', listener);
        };
    }, [
        bridgeAllowsWildcardTargetOrigin,
        bridgeEnabled,
        bridgeExactDocumentChannel,
        bridgeTargetOrigin,
        props.navigationKey,
        props.url,
        props.html,
    ]);

    React.useEffect(() => {
        applyWebIframeNavigationCommand(iframeRef.current, props.navigationCommand);
    }, [props.navigationCommand?.commandId, props.navigationCommand?.kind]);

    const handleLoad = React.useCallback(() => {
        if (props.revokeOnUnexpectedNavigation && hasLoadedCurrentNavigationRef.current) {
            bridgeDocumentRetiredRef.current = true;
            props.onUnexpectedNavigation?.();
            return;
        }
        hasLoadedCurrentNavigationRef.current = true;
        setLoadedDocumentRevision((revision) => revision + 1);
        props.onLoad?.();
    }, [props.onLoad, props.onUnexpectedNavigation, props.revokeOnUnexpectedNavigation]);

    return (
        <View testID={`${props.testID}-container`} style={browserFrameStyles.root}>
            {React.createElement('iframe', {
                'data-browser-navigation-key': props.navigationKey,
                'data-testid': props.testID,
                key: props.navigationKey,
                onError: props.onError,
                onLoad: handleLoad,
                ref: iframeRef,
                referrerPolicy: props.referrerPolicy ?? 'no-referrer',
                ...(props.csp ? { csp: props.csp } : {}),
                sandbox: props.sandbox,
                ...(props.html === undefined ? { src: props.url } : { srcDoc: props.html }),
                style: iframeStyle,
                title: props.title,
            })}
        </View>
    );
}

import type { PluginHostedWebBridgeEnvelopeV1 } from '@happier-dev/protocol';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

let lastWebViewProps: Readonly<Record<string, unknown>> | null = null;

vi.mock('react-native-webview', () => ({
    WebView: (props: Readonly<Record<string, unknown>>) => {
        lastWebViewProps = props;
        return React.createElement('WebView', props);
    },
}));

describe('HostedPluginTarget native', () => {
    it('mounts inline source through the existing native engine without a URL or Artifact', async () => {
        const { HostedPluginTarget } = await import('./HostedPluginTarget.native');
        lastWebViewProps = null;
        await renderScreen(<HostedPluginTarget title="Inline" html="<p>Inline</p>" testID="inline" />);
        const webViewProps = lastWebViewProps as Readonly<Record<string, unknown>> | null;
        expect(webViewProps?.source).toEqual({ html: expect.stringContaining('<p>Inline</p>'), baseUrl: 'about:blank' });
        expect((webViewProps?.source as { html: string }).html).toContain("default-src 'none'");
        expect(webViewProps).toMatchObject({
            cacheEnabled: false,
            domStorageEnabled: false,
            sharedCookiesEnabled: false,
            thirdPartyCookiesEnabled: false,
            allowFileAccess: false,
            allowFileAccessFromFileURLs: false,
            allowUniversalAccessFromFileURLs: false,
            javaScriptCanOpenWindowsAutomatically: false,
            mixedContentMode: 'never',
        });
        const shouldStartLoad = webViewProps?.onShouldStartLoadWithRequest as (
            request: Readonly<{ url: string; isTopFrame?: boolean }>,
        ) => boolean;
        expect(shouldStartLoad({ url: 'about:blank', isTopFrame: true })).toBe(true);
        expect(shouldStartLoad({ url: 'https://escape.example.test', isTopFrame: true })).toBe(false);
    });
    it('blocks insecure non-loopback hosted-plugin URLs before creating a native WebView', async () => {
        const { HostedPluginTarget } = await import('./HostedPluginTarget.native');
        lastWebViewProps = null;

        const screen = await renderScreen(
            <HostedPluginTarget
                title="Hosted plugin"
                url="http://plugin.example.test/plugin"
                sandbox={{
                    scripts: true,
                    sameOrigin: false,
                    popups: false,
                    topNavigation: false,
                    mixedContent: false,
                }}
                security={{
                    allowedNavigationOrigins: [],
                    allowedCallbackOrigins: [],
                    allowedConnectOrigins: [],
                    csp: {
                        connectSrc: 'selfOnly',
                        allowDataUrls: false,
                        allowBlobUrls: false,
                        allowInlineStyles: false,
                        allowEval: false,
                    },
                    sourceMaps: 'disabled',
                    mixedContent: 'deny',
                }}
                testID="hosted-plugin"
            />,
        );

        expect(lastWebViewProps).toBeNull();
        expect(screen.findByTestId('hosted-plugin-unavailable')).toBeTruthy();
    });

    it('includes allowed navigation origins in the native WebView origin whitelist without duplicates', async () => {
        const { HostedPluginTarget } = await import('./HostedPluginTarget.native');
        lastWebViewProps = null;

        await renderScreen(
            <HostedPluginTarget
                title="Hosted plugin"
                url="https://preview.example.test/plugin"
                sandbox={{
                    scripts: true,
                    sameOrigin: false,
                    popups: false,
                    topNavigation: false,
                    mixedContent: false,
                }}
                security={{
                    allowedNavigationOrigins: [
                        'https://docs.example.test',
                        'https://preview.example.test',
                    ],
                    allowedCallbackOrigins: [
                        'https://callback.example.test',
                        'https://docs.example.test',
                    ],
                    allowedConnectOrigins: [],
                    csp: {
                        connectSrc: 'selfOnly',
                        allowDataUrls: false,
                        allowBlobUrls: false,
                        allowInlineStyles: false,
                        allowEval: false,
                    },
                    sourceMaps: 'disabled',
                    mixedContent: 'deny',
                }}
                testID="hosted-plugin"
            />,
        );

        expect((lastWebViewProps as Readonly<{
            originWhitelist?: readonly string[];
        }> | null)?.originWhitelist).toEqual([
            'https://preview.example.test',
            'https://callback.example.test',
            'https://docs.example.test',
        ]);
    });

    it('validates and forwards hosted-plugin bridge messages from the native WebView frame', async () => {
        const { HostedPluginTarget } = await import('./HostedPluginTarget.native');
        const onMessage = vi.fn<(envelope: PluginHostedWebBridgeEnvelopeV1) => void>();

        await renderScreen(
            <HostedPluginTarget
                title="Hosted plugin"
                url="https://preview.example.test/plugin"
                sandbox={{
                    scripts: true,
                    sameOrigin: false,
                    popups: false,
                    topNavigation: false,
                    mixedContent: false,
                }}
                testID="hosted-plugin"
                bridge={{
                    expectedOrigin: 'https://preview.example.test',
                    identity: { instanceId: 'mount-1', mountNonce: 'nonce-1' },
                    allowedMessageKinds: new Set(['ready']),
                    onMessage,
                }}
            />,
        );

        expect(lastWebViewProps?.onMessage).toBeTypeOf('function');
        const dispatchMessage = lastWebViewProps?.onMessage as (event: {
            nativeEvent: {
                data: string;
                url: string;
            };
        }) => void;

        dispatchMessage({
            nativeEvent: {
                url: 'https://evil.example.test/plugin',
                data: JSON.stringify({
                    version: 1,
                    identity: { instanceId: 'mount-1', mountNonce: 'nonce-1' },
                    sequence: 1,
                    kind: 'ready',
                    payload: { ready: true },
                }),
            },
        });
        dispatchMessage({
            nativeEvent: {
                url: 'https://preview.example.test/plugin',
                data: JSON.stringify({
                    version: 1,
                    identity: { instanceId: 'mount-1', mountNonce: 'wrong-nonce' },
                    sequence: 1,
                    kind: 'ready',
                    payload: { ready: true },
                }),
            },
        });
        dispatchMessage({
            nativeEvent: {
                url: 'https://preview.example.test/plugin',
                data: JSON.stringify({
                    version: 1,
                    identity: { instanceId: 'mount-1', mountNonce: 'nonce-1' },
                    sequence: 1,
                    kind: 'ready',
                    payload: { ready: true },
                }),
            },
        });

        expect(onMessage).toHaveBeenCalledTimes(1);
        expect(onMessage.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            kind: 'ready',
            identity: { instanceId: 'mount-1', mountNonce: 'nonce-1' },
        }));
    });

    it('keeps a stable hook order while native hosted-plugin admission changes', async () => {
        const { HostedPluginTarget } = await import('./HostedPluginTarget.native');
        const element = (url: string) => (
            <HostedPluginTarget
                title="Hosted plugin"
                url={url}
                sandbox={{
                    scripts: true,
                    sameOrigin: false,
                    popups: false,
                    topNavigation: false,
                    mixedContent: false,
                }}
                security={{
                    allowedNavigationOrigins: [],
                    allowedCallbackOrigins: [],
                    allowedConnectOrigins: [],
                    csp: {
                        connectSrc: 'selfOnly',
                        allowDataUrls: false,
                        allowBlobUrls: false,
                        allowInlineStyles: false,
                        allowEval: false,
                    },
                    sourceMaps: 'disabled',
                    mixedContent: 'deny',
                }}
                testID="hosted-plugin"
            />
        );
        lastWebViewProps = null;

        const screen = await renderScreen(element('http://plugin.example.test/plugin'));
        expect(screen.findByTestId('hosted-plugin-unavailable')).toBeTruthy();

        await screen.update(element('https://preview.example.test/plugin'));
        expect(lastWebViewProps).not.toBeNull();

        await screen.update(element('http://plugin.example.test/plugin'));
        expect(screen.findByTestId('hosted-plugin-unavailable')).toBeTruthy();
    });
});

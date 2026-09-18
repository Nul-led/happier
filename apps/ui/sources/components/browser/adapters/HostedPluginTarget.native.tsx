import type {
    PluginHostedWebBridgeBootstrapConfigV1,
    PluginHostedWebSecurityPolicyV1,
} from '@happier-dev/protocol';
import type { UiSurfaceNetworkOriginV1 } from '@happier-dev/protocol/plugins/ui';
import * as React from 'react';

import type { PluginHostedWebSandboxPolicy } from '@/components/plugins/hostedWeb/sandbox';
import { createPluginHostedWebNativeMessageBridge, type PluginHostedWebNativeBridgeConfig } from '@/components/plugins/hostedWeb/nativeMessageBridge';
import { buildHostedHtmlDocument } from '@/components/plugins/hostedWeb/buildHostedHtmlDocument';
import { resolveUrlOrigin } from '@/sync/domains/browser/adapters/targets/localPreview';

import { BrowserViewFrame } from '../frame/BrowserViewFrame.native';
import {
    canLoadHostedPluginTargetUrl,
    DEFAULT_HOSTED_PLUGIN_SECURITY,
    isLoopbackHostedWebUrl,
} from './HostedPluginTargetSecurity';
import type {
    BrowserDiagnosticsEngineBridgeConfig,
    BrowserFrameNavigationCommand,
    NativeWebViewSource,
    BrowserFrameHostMessageAttachment,
} from '../frame/types';

const DEFAULT_HOSTED_PLUGIN_SANDBOX: PluginHostedWebSandboxPolicy = {
    scripts: true,
    sameOrigin: false,
    popups: false,
    topNavigation: false,
    mixedContent: false,
};

function resolveNativeMixedContentMode(
    security: PluginHostedWebSecurityPolicyV1,
    url: string,
): 'never' | 'compatibility' {
    return security.mixedContent === 'devLoopbackOnly' && isLoopbackHostedWebUrl(url)
        ? 'compatibility'
        : 'never';
}

export function HostedPluginTarget(props: Readonly<{
    title: string;
    sandbox?: PluginHostedWebSandboxPolicy;
    security?: PluginHostedWebSecurityPolicyV1;
    testID: string;
    navigationCommand?: BrowserFrameNavigationCommand;
    bootstrapConfig?: PluginHostedWebBridgeBootstrapConfigV1;
    onUnexpectedNavigation?: () => void;
    bridge?: (PluginHostedWebNativeBridgeConfig & Partial<BrowserFrameHostMessageAttachment>) | null;
    diagnostics?: BrowserDiagnosticsEngineBridgeConfig;
    networkOrigins?: readonly UiSurfaceNetworkOriginV1[];
}> & NativeWebViewSource): React.ReactElement {
    const sandbox = props.sandbox ?? DEFAULT_HOSTED_PLUGIN_SANDBOX;
    const security = props.security ?? DEFAULT_HOSTED_PLUGIN_SECURITY;
    const origin = props.url === undefined ? null : resolveUrlOrigin(props.url);
    const html = React.useMemo(() => props.html === undefined
        ? undefined
        : buildHostedHtmlDocument(props.html, props.bootstrapConfig, { networkOrigins: props.networkOrigins }), [props.html, props.bootstrapConfig, props.networkOrigins]);
    const nativeMessageBridge = React.useMemo(() => {
        const bridge = props.bridge;
        if (!bridge) return undefined;
        return {
            ...(bridge.attachHostMessages ? { attachHostMessages: bridge.attachHostMessages } : {}),
            onMessage: createPluginHostedWebNativeMessageBridge({
                bridge,
            }),
        };
    }, [props.bridge]);
    if (props.html === undefined && (!origin || !props.url || !canLoadHostedPluginTargetUrl({ security, url: props.url }))) {
        return (
            <BrowserViewFrame
                engine={{
                    kind: 'unavailable',
                    reasonCode: origin ? 'hosted_plugin_security_policy_blocked' : 'invalid_url',
                    testID: props.testID,
                }}
            />
        );
    }

    return (
        <BrowserViewFrame
            engine={{
                kind: 'nativeWebView',
                title: props.title,
                ...(html !== undefined ? { html } : { url: props.url! }),
                testID: props.testID,
                navigationCommand: props.navigationCommand,
                originWhitelist: props.html !== undefined ? [] : [...new Set([
                    origin!,
                    ...security.allowedCallbackOrigins,
                    ...security.allowedNavigationOrigins,
                ])],
                javaScriptEnabled: sandbox.scripts,
                mixedContentMode: props.url === undefined ? 'never' : resolveNativeMixedContentMode(security, props.url),
                diagnostics: props.diagnostics,
                nativeMessageBridge,
                onBlockedNavigation: props.html === undefined ? undefined : props.onUnexpectedNavigation,
                onUnexpectedNavigation: props.html === undefined ? undefined : props.onUnexpectedNavigation,
            }}
        />
    );
}

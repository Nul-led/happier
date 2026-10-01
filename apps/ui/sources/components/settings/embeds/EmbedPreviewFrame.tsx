import * as React from 'react';
import { View } from 'react-native';

import { NativeWebViewEngine } from '@/components/browser/frame/engines/NativeWebViewEngine';
import type { BrowserNativeFrameMessageBridgeConfig } from '@/components/browser/frame/types';
import { getServerUrl } from '@/sync/domains/server/serverConfig';
import { resolveWebappUrlFromServerUrl } from '@/sync/domains/server/url/resolveWebappUrlFromServerUrl';

import { isEmbedPreviewReadyEnvelope } from '@/embed/preview/embedPreviewConfiguration';

import { useEmbedPreviewConfigure, type EmbedPreviewFrameProps } from './useEmbedPreviewConfigure';

function readOrigin(url: string): string | null {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}

function readJson(data: string | undefined): unknown {
    if (typeof data !== 'string') return null;
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
}

/**
 * iOS and Android: the same preview route, served by this Home's web app, in the app's WebView engine.
 * The engine's host-message push delivers the same `configure` envelopes the web iframe posts, and
 * the route's ready signal is answered with the current configuration.
 */
export function EmbedPreviewFrame(props: EmbedPreviewFrameProps): React.ReactElement {
    const webappUrl = React.useMemo(() => resolveWebappUrlFromServerUrl(getServerUrl()), []);
    const origin = readOrigin(webappUrl);
    const nextEnvelope = useEmbedPreviewConfigure(props.identity, props.configuration);
    const sendRef = React.useRef<((message: unknown) => void) | null>(null);
    const bridge = React.useMemo<BrowserNativeFrameMessageBridgeConfig>(() => ({
        onMessage: (event) => (
            isEmbedPreviewReadyEnvelope(readJson(event.nativeEvent?.data), props.identity) ? nextEnvelope() : null
        ),
        attachHostMessages: (send) => {
            sendRef.current = send;
            return () => {
                if (sendRef.current === send) sendRef.current = null;
            };
        },
    }), [nextEnvelope, props.identity]);

    React.useEffect(() => {
        const envelope = nextEnvelope();
        if (envelope) sendRef.current?.(envelope);
    }, [nextEnvelope, props.configuration]);

    // A Home without a web app has no preview route to load.
    const { onUnavailable } = props;
    React.useEffect(() => {
        if (!origin) onUnavailable();
    }, [onUnavailable, origin]);

    return (
        <View
            style={{
                width: props.frameWidth,
                height: props.height / props.scale,
                transform: [{ scale: props.scale }],
                transformOrigin: 'top left',
            }}
        >
            {origin ? (
                <NativeWebViewEngine
                    title={props.title}
                    testID="settings-embed-preview-frame"
                    url={`${origin}${props.path}`}
                    originWhitelist={[origin]}
                    nativeMessageBridge={bridge}
                    onError={props.onUnavailable}
                />
            ) : null}
        </View>
    );
}

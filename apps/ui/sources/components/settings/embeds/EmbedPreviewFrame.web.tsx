import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { isEmbedPreviewReadyEnvelope } from '@/embed/preview/embedPreviewConfiguration';

import { useEmbedPreviewConfigure, type EmbedPreviewFrameProps } from './useEmbedPreviewConfigure';

/** Web: the preview route in a same-origin iframe, configured through `postMessage`. */
export function EmbedPreviewFrame(props: EmbedPreviewFrameProps): React.ReactElement {
    const { theme } = useUnistyles();
    const frameRef = React.useRef<HTMLIFrameElement | null>(null);
    const nextEnvelope = useEmbedPreviewConfigure(props.identity, props.configuration);
    const send = React.useCallback(() => {
        const target = frameRef.current?.contentWindow;
        if (!target) return;
        const envelope = nextEnvelope();
        if (envelope) target.postMessage(envelope, window.location.origin);
    }, [nextEnvelope]);

    React.useEffect(() => {
        send();
    }, [props.configuration, send]);

    React.useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.source !== frameRef.current?.contentWindow || event.origin !== window.location.origin) return;
            if (isEmbedPreviewReadyEnvelope(event.data, props.identity)) send();
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [props.identity, send]);

    return React.createElement('iframe', {
        ref: frameRef,
        title: props.title,
        tabIndex: props.passive ? -1 : undefined,
        'aria-hidden': props.passive || undefined,
        src: props.path,
        onLoad: send,
        onError: props.onUnavailable,
        style: {
            border: 0,
            width: props.frameWidth,
            height: props.height / props.scale,
            transform: `scale(${props.scale})`,
            transformOrigin: 'top left',
            background: theme.colors.background.canvas,
        },
    });
}

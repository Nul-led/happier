import * as React from 'react';
import type { EmbedHostToFrameEnvelopeV1, FrameBridgeIdentityV1 } from '@happier-dev/protocol/embed';

import { buildEmbedPreviewConfigureEnvelope, type EmbedPreviewConfiguration } from '@/embed/preview/embedPreviewConfiguration';

/** What the platform preview frame renders: the web iframe and the native WebView take the same props. */
export type EmbedPreviewFrameProps = Readonly<{
    title: string;
    /** The preview route with its search (`/embed/preview?…`). */
    path: string;
    identity: FrameBridgeIdentityV1;
    configuration: EmbedPreviewConfiguration;
    frameWidth: number;
    height: number;
    scale: number;
    /** An illustration cannot be focused or interacted with. */
    passive?: boolean;
    /** The frame could not show the preview route (no web app to load, or the load failed). */
    onUnavailable: () => void;
}>;

/**
 * The preview frame's one delivery rule, shared by the web iframe and the native WebView: every
 * `configure` carries the latest whole configuration with the next sequence, whether it answers the
 * route's ready signal or pushes an edit.
 */
export function useEmbedPreviewConfigure(
    identity: FrameBridgeIdentityV1,
    configuration: EmbedPreviewConfiguration,
): () => EmbedHostToFrameEnvelopeV1 | null {
    const sequenceRef = React.useRef(0);
    const latestRef = React.useRef(configuration);
    latestRef.current = configuration;
    return React.useCallback(() => buildEmbedPreviewConfigureEnvelope({
        identity,
        sequence: sequenceRef.current++,
        configuration: latestRef.current,
    }), [identity]);
}

import {
    EmbedFrameToHostEnvelopeV1Schema,
    EmbedHostToFrameEnvelopeV1Schema,
    wireIdentitiesEqual,
    type EmbedConfigureV1,
    type EmbedFrameToHostEnvelopeV1,
    type EmbedHostToFrameEnvelopeV1,
    type EmbedStyleV1,
    type EmbedUiOverridesV1,
    type FrameBridgeIdentityV1,
} from '@happier-dev/protocol/embed';

/** What the preview renders from: the whole current style and UI overrides, as a host sends them. */
export type EmbedPreviewConfiguration = Readonly<{
    style: EmbedStyleV1 | null;
    ui: EmbedUiOverridesV1;
}>;

export const EMPTY_EMBED_PREVIEW_CONFIGURATION: EmbedPreviewConfiguration = Object.freeze({ style: null, ui: Object.freeze({}) });

/**
 * Settings' side of the preview bridge: the same `configure` envelope a host page sends an embed.
 * The web iframe and the native WebView deliver exactly this; there is no preview-only message.
 */
export function buildEmbedPreviewConfigureEnvelope(input: Readonly<{
    identity: FrameBridgeIdentityV1;
    sequence: number;
    configuration: EmbedPreviewConfiguration;
}>): EmbedHostToFrameEnvelopeV1 | null {
    const envelope = EmbedHostToFrameEnvelopeV1Schema.safeParse({
        version: 1,
        identity: input.identity,
        sequence: input.sequence,
        direction: 'hostToFrame',
        payload: {
            kind: 'configure',
            ui: input.configuration.ui,
            ...(input.configuration.style ? { style: input.configuration.style } : {}),
        },
    });
    return envelope.success ? envelope.data : null;
}

/**
 * The preview's "I am listening" signal, sent once its guest is attached: the bridge's existing
 * `state` message. The Settings side answers with the current configuration, so an edit made while
 * the route was still loading is never lost to a `load` event that fired before the listener.
 */
export function buildEmbedPreviewReadyEnvelope(identity: FrameBridgeIdentityV1): EmbedFrameToHostEnvelopeV1 {
    return { version: 1, identity, sequence: 0, payload: { kind: 'state', sessionId: null, phase: 'ready' } };
}

export function isEmbedPreviewReadyEnvelope(data: unknown, identity: FrameBridgeIdentityV1): boolean {
    const envelope = EmbedFrameToHostEnvelopeV1Schema.safeParse(data);
    return envelope.success
        && envelope.data.payload.kind === 'state'
        && envelope.data.payload.phase === 'ready'
        && wireIdentitiesEqual(envelope.data.identity, identity);
}

function sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/**
 * Adopts a `configure` while keeping the previous references for parts that did not change, so a
 * re-sent identical style does not re-apply the theme or reload the font face.
 */
export function adoptEmbedPreviewConfiguration(
    previous: EmbedPreviewConfiguration,
    configure: EmbedConfigureV1,
): EmbedPreviewConfiguration {
    const style = configure.style ?? null;
    const ui = configure.ui ?? EMPTY_EMBED_PREVIEW_CONFIGURATION.ui;
    const nextStyle = sameJson(previous.style, style) ? previous.style : style;
    const nextUi = sameJson(previous.ui, ui) ? previous.ui : ui;
    return nextStyle === previous.style && nextUi === previous.ui ? previous : { style: nextStyle, ui: nextUi };
}

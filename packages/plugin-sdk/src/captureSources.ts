import type { MachineLiveStreamFrameV1, MachineLiveStreamReceiptV1, MachineLiveStreamCodecIdV1 } from '@happier-dev/protocol';
export type PluginCaptureCodecIdV1 = MachineLiveStreamCodecIdV1;
export type PluginCaptureSourceDeclaration = Readonly<{
    displayName: string;
    streamFamily: string;
    supportedCodecs: readonly PluginCaptureCodecIdV1[];
}>;
export type PluginCaptureFrameV1 = MachineLiveStreamFrameV1;
export type PluginCaptureReceiptV1 = MachineLiveStreamReceiptV1;

/** Frames are offered to the host transport; the plugin never owns viewer routes. */
export interface PluginCaptureSourceRuntime {
    start(input: Readonly<{
        streamId: string;
        signal: AbortSignal;
        offerFrame(frame: PluginCaptureFrameV1): Readonly<{ ok: true } | { ok: false; reasonCode: string }>;
        emitReceipt(receipt: PluginCaptureReceiptV1): void;
    }>): Promise<Readonly<{ stop(): void | Promise<void> }>>;
}

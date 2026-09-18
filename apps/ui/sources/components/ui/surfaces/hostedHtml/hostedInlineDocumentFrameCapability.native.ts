import { isHostedInlineDocumentFrameNativeAdapterAvailable } from '@/components/plugins/hostedWeb/HostedArtifactFrame.native';

/** Native support is factual: both the isolated view and registrar must exist. */
export function isHostedInlineDocumentFrameAvailable(): boolean {
    return isHostedInlineDocumentFrameNativeAdapterAvailable();
}

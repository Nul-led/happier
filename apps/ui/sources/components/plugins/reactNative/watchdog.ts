import { PluginUiArtifactDigestV1Schema } from '@happier-dev/protocol/plugins/ui';

type ArtifactDigest = `sha256:${string}`;

export type PluginReactNativeWatchdog = Readonly<{
    recordFailure: (input: Readonly<{ artifactDigest: ArtifactDigest }>) => void;
    clear: (input: Readonly<{ artifactDigest: ArtifactDigest }>) => void;
    isContained: (input: Readonly<{ artifactDigest: ArtifactDigest }>) => boolean;
}>;

export function createPluginReactNativeWatchdog(): PluginReactNativeWatchdog {
    const containedDigests = new Set<ArtifactDigest>();

    return Object.freeze({
        recordFailure(input) {
            containedDigests.add(PluginUiArtifactDigestV1Schema.parse(input.artifactDigest));
        },
        clear(input) {
            containedDigests.delete(PluginUiArtifactDigestV1Schema.parse(input.artifactDigest));
        },
        isContained(input) {
            return containedDigests.has(PluginUiArtifactDigestV1Schema.parse(input.artifactDigest));
        },
    });
}

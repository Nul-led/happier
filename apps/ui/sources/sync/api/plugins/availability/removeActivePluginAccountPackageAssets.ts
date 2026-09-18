import {
    PluginAvailabilityActionHttpPathsV1,
    PluginAvailabilityPackageAssetRemoveActionInputV1Schema,
    PluginAvailabilityPackageAssetRemoveActionOutputV1Schema,
    type PluginAvailabilityPackageAssetRemoveActionInputV1,
} from '@happier-dev/protocol/plugins/availability';

import {
    createActivePluginAccountArtifactRemover,
    type ActivePluginAccountArtifactRemoverDependencies,
    type ActivePluginAccountArtifactRemoveResult,
} from './activePluginAccountArtifactRemoval';

export type ActivePluginAccountPackageAssetsRemoverDependencies = ActivePluginAccountArtifactRemoverDependencies;
export type ActivePluginAccountPackageAssetsRemoveResult = ActivePluginAccountArtifactRemoveResult;

export function createActivePluginAccountPackageAssetsRemover(
    overrides: Partial<ActivePluginAccountPackageAssetsRemoverDependencies> = {},
) {
    return createActivePluginAccountArtifactRemover<PluginAvailabilityPackageAssetRemoveActionInputV1>({
        path: PluginAvailabilityActionHttpPathsV1['account.plugins.availability.packageAsset.remove'],
        parseTarget: (target) => PluginAvailabilityPackageAssetRemoveActionInputV1Schema.safeParse(target),
        matchesResponse: (raw, target) => {
            const output = PluginAvailabilityPackageAssetRemoveActionOutputV1Schema.safeParse(raw);
            return output.success
                && output.data.link.release.pluginId === target.release.pluginId
                && output.data.link.release.version === target.release.version;
        },
    }, overrides);
}

const installedRemover = createActivePluginAccountPackageAssetsRemover();

export async function removeActivePluginAccountPackageAssets(input: Parameters<typeof installedRemover.remove>[0]) {
    return await installedRemover.remove(input);
}

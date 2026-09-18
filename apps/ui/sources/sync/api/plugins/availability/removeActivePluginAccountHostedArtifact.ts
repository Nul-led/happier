import {
    PluginAvailabilityActionHttpPathsV1,
    PluginAvailabilityUiArtifactRemoveActionInputV1Schema,
    PluginAvailabilityUiArtifactRemoveActionOutputV1Schema,
    type PluginAvailabilityUiArtifactRemoveActionInputV1,
} from '@happier-dev/protocol/plugins/availability';

import {
    createActivePluginAccountArtifactRemover,
    type ActivePluginAccountArtifactRemoverDependencies,
    type ActivePluginAccountArtifactRemoveResult,
} from './activePluginAccountArtifactRemoval';

export type ActivePluginAccountHostedArtifactRemoverDependencies = ActivePluginAccountArtifactRemoverDependencies;
export type ActivePluginAccountHostedArtifactRemoveResult = ActivePluginAccountArtifactRemoveResult;

export function createActivePluginAccountHostedArtifactRemover(
    overrides: Partial<ActivePluginAccountHostedArtifactRemoverDependencies> = {},
) {
    return createActivePluginAccountArtifactRemover<PluginAvailabilityUiArtifactRemoveActionInputV1>({
        path: PluginAvailabilityActionHttpPathsV1['account.plugins.availability.uiArtifact.remove'],
        parseTarget: (target) => PluginAvailabilityUiArtifactRemoveActionInputV1Schema.safeParse(target),
        matchesResponse: (raw, target) => {
            const output = PluginAvailabilityUiArtifactRemoveActionOutputV1Schema.safeParse(raw);
            return output.success
                && output.data.link.release.pluginId === target.release.pluginId
                && output.data.link.release.version === target.release.version
                && output.data.link.contributionId === target.contributionId
                && output.data.link.tier === target.tier
                && output.data.link.platform === target.platform;
        },
    }, overrides);
}

const installedRemover = createActivePluginAccountHostedArtifactRemover();

export async function removeActivePluginAccountHostedArtifact(input: Parameters<typeof installedRemover.remove>[0]) {
    return await installedRemover.remove(input);
}

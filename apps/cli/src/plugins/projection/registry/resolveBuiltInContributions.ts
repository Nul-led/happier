import { BUILT_IN_INSTALLABLE_CONTRIBUTIONS } from '@happier-dev/protocol/installables';

import { BUNDLED_FIRST_PARTY_AGENT_REGISTRATION_BINDINGS } from './sources/generatedBundledPlugins';
import { projectBuiltInAgents } from './builtIn/agents';
import { loadCurrentBundledPluginLocatorResult } from './builtIn/locators';
import { projectLoadedPluginContributes } from './resolvePluginContributions';
import type { ResolvedContributionInputs, ResolvedInstallableContribution } from './types';

const EMPTY_CONTRIBUTIONS = Object.freeze([]);

type ResolvedBuiltInContributionInputs = ResolvedContributionInputs & Required<
    Pick<ResolvedContributionInputs, 'agents' | 'providers'>
>;

/**
 * Projects first-party packages through the same canonical manifest path as
 * installed plugins, then joins only host-owned canonical identity and proven
 * bundled backend-compatibility facts. Author-owned CLI, catalog, capability,
 * and presentation facts remain on the public manifest projection.
 */
export function resolveBuiltInContributions(): ResolvedBuiltInContributionInputs {
    const bundled = loadCurrentBundledPluginLocatorResult();
    const projected = projectLoadedPluginContributes({
        loadResult: {
            loadedPlugins: bundled.loadedPlugins,
            diagnosticsByPluginId: Object.fromEntries(bundled.pluginFailures.map((failure) => [
                failure.pluginId,
                [failure.diagnostic],
            ])),
        },
        provenance: 'first_party',
    });
    const agents = projectBuiltInAgents({
        manifestAgents: projected.agents ?? EMPTY_CONTRIBUTIONS,
        registrationBindings: BUNDLED_FIRST_PARTY_AGENT_REGISTRATION_BINDINGS,
    });

    return Object.freeze({
        ...projected,
        agents,
        providers: projected.providers ?? EMPTY_CONTRIBUTIONS,
        catalogEntries: EMPTY_CONTRIBUTIONS,
        managedDependencies: Object.freeze([
            ...BUILT_IN_INSTALLABLE_CONTRIBUTIONS.map(({ descriptor, owner }) => ({
                provenance: 'first_party',
                source: { kind: 'bundled' },
                pluginId: owner.ownerId,
                definition: descriptor,
            } satisfies ResolvedInstallableContribution)),
            ...(projected.managedDependencies ?? EMPTY_CONTRIBUTIONS),
        ]),
    });
}

import type { PluginSourceCustodyV1 } from '@happier-dev/protocol';

import {
    createDeclarativeAcpAgentRuntimeRegistry as createDeclarativeAcpAgentRuntimeRegistryProduction,
    createTargetAgentRuntimeRegistry as createTargetAgentRuntimeRegistryProduction,
} from './targetAgents';
import {
    createBundledFirstPartyPluginSourceCustody,
    createManagedPluginSourceCustody,
} from './runtimeIdentity.testkit';

type TargetRegistryParams = Parameters<
    typeof createTargetAgentRuntimeRegistryProduction
>[0];

type DeclarativeRegistryParams = Parameters<
    typeof createDeclarativeAcpAgentRuntimeRegistryProduction
>[0];

type RuntimeIdentityReaders = Pick<
    TargetRegistryParams,
    'readPluginOccurrenceId' | 'readPluginSourceCustody'
>;

type WithOptionalRuntimeIdentity<Params> = Params extends RuntimeIdentityReaders
    ? Omit<Params, keyof RuntimeIdentityReaders> & Partial<RuntimeIdentityReaders>
    : never;

type TargetRegistryFixtureParams = WithOptionalRuntimeIdentity<TargetRegistryParams>;

type DeclarativeRegistryFixtureParams = WithOptionalRuntimeIdentity<DeclarativeRegistryParams> & Readonly<{
    occurrenceId: string;
}>;

function readTargetOccurrenceId(
    params: TargetRegistryFixtureParams,
    pluginId: string,
): string | null {
    return params.targetRegistrations.find(
        (registration) => registration.pluginId === pluginId,
    )?.occurrenceId ?? null;
}

function createTargetFixtureSourceCustody(
    params: TargetRegistryFixtureParams,
    pluginId: string,
): PluginSourceCustodyV1 | null {
    const target = params.activationTargets.find(
        (candidate) => candidate.pluginId === pluginId,
    );
    if (!target) return null;
    if (target.provenance === 'first_party') {
        return createBundledFirstPartyPluginSourceCustody(
            `fixture-version-root:${pluginId}`,
        );
    }
    const immutableGenerationId = params.immutableGenerationIdsByPluginId?.get(pluginId)
        ?? readTargetOccurrenceId(params, pluginId);
    return immutableGenerationId
        ? createManagedPluginSourceCustody(immutableGenerationId)
        : null;
}

export function createTargetAgentRuntimeRegistry(
    params: TargetRegistryFixtureParams,
): ReturnType<typeof createTargetAgentRuntimeRegistryProduction> {
    return createTargetAgentRuntimeRegistryProduction({
        ...params,
        readPluginOccurrenceId: params.readPluginOccurrenceId
            ?? ((pluginId) => {
                return readTargetOccurrenceId(params, pluginId);
            }),
        readPluginSourceCustody: params.readPluginSourceCustody
            ?? ((pluginId) => createTargetFixtureSourceCustody(params, pluginId)),
    });
}

export function createDeclarativeAcpAgentRuntimeRegistry(
    params: DeclarativeRegistryFixtureParams,
): ReturnType<typeof createDeclarativeAcpAgentRuntimeRegistryProduction> {
    return createDeclarativeAcpAgentRuntimeRegistryProduction({
        ...params,
        readPluginOccurrenceId: params.readPluginOccurrenceId
            ?? (() => params.occurrenceId),
        readPluginSourceCustody: params.readPluginSourceCustody
            ?? ((pluginId) => createManagedPluginSourceCustody(
                    params.immutableGenerationIdsByPluginId?.get(pluginId)
                    ?? `fixture-custody:${pluginId}`,
                )),
    });
}

import type { CanonicalPluginManifest } from '../manifest/types';
import { projectPackedSessionRunnerModulePath } from '../authoring/projectPackedSessionRunnerModulePath';

export class RetainedAgentFactoryLocatorError extends Error {
    readonly code = 'RETAINED_AGENT_FACTORY_LOCATOR_INVALID';
}

/** The published manifest, not the daemon's current registration, owns this locator. */
export function readRetainedBundledAgentFactory(
    manifest: CanonicalPluginManifest | undefined,
    localAgentId: string,
) {
    const factory = manifest?.runtime.agentFactories?.find(
        (candidate) => candidate.localAgentId === localAgentId,
    );
    if (!factory) {
        throw new RetainedAgentFactoryLocatorError(
            `Retained Agent '${localAgentId}' has no published factory locator`,
        );
    }
    if (!manifest?.contributes.agents.some((agent) => agent.id === localAgentId)) {
        throw new RetainedAgentFactoryLocatorError(
            `Retained Agent '${localAgentId}' factory has no admitted declaration`,
        );
    }
    const daemonEntrypoint = manifest.entrypoints?.daemon;
    if (!daemonEntrypoint) {
        throw new RetainedAgentFactoryLocatorError(
            `Retained Agent '${localAgentId}' has no published daemon entrypoint`,
        );
    }
    let expectedModulePath: string;
    try {
        expectedModulePath = projectPackedSessionRunnerModulePath({
            daemonEntrypoint,
            locatorModule: factory.locator.module,
        });
    } catch {
        throw new RetainedAgentFactoryLocatorError(
            `Retained Agent '${localAgentId}' has an invalid published factory locator`,
        );
    }
    if (expectedModulePath !== factory.normalizedModulePath) {
        throw new RetainedAgentFactoryLocatorError(
            `Retained Agent '${localAgentId}' factory locator differs from its packaged module`,
        );
    }
    return factory;
}

import {
    convertBackendTargetRefV2ToV1,
    getProfileEnvironmentVariables as getProfileEnvironmentVariablesProtocol,
    isProfileCompatibleWithBackendTarget as isProfileCompatibleWithBackendTargetProtocol,
    isProfileCompatibleWithAgent as isProfileCompatibleWithAgentProtocol,
    readBackendTargetRefV2,
    type BackendTargetRefV2Input,
} from '@happier-dev/protocol';
import { resolveBackendTargetKeyV2 } from '@/agents/backendCatalog/backendTargetKeyV2';
import { resolveBundledAgentIdFromContributionIdentity } from '@/agents/catalog/catalog';
import type { AgentId } from '@/agents/registry/registryCore';

export {
    AIBackendProfileSchema,
    type AIBackendProfile,
} from './aiBackendProfileSchema';
import type { AIBackendProfile } from './aiBackendProfileSchema';
export type ProfileCompatibilitySummary =
    Pick<AIBackendProfile, 'compatibility' | 'isBuiltIn'>
    & Partial<Pick<AIBackendProfile, 'compatibilityByTargetKey'>>;

function normalizeCompatibilityProfile(
    profile: ProfileCompatibilitySummary,
): Pick<AIBackendProfile, 'compatibility' | 'compatibilityByTargetKey' | 'isBuiltIn'> {
    return {
        compatibility: profile.compatibility,
        compatibilityByTargetKey: profile.compatibilityByTargetKey ?? {},
        isBuiltIn: profile.isBuiltIn,
    };
}

export function isProfileCompatibleWithBackendTarget(
    profile: ProfileCompatibilitySummary,
    target: BackendTargetRefV2Input,
): boolean {
    const canonicalTargetKey = resolveBackendTargetKeyV2(target);
    const explicitCanonical = profile.compatibilityByTargetKey?.[canonicalTargetKey];
    if (typeof explicitCanonical === 'boolean') return explicitCanonical;
    if (typeof target !== 'string' && target.kind === 'agent') {
        const bundledAgentId = resolveBundledAgentIdFromContributionIdentity(target.identity);
        if (bundledAgentId !== null) {
            return isProfileCompatibleWithBackendTargetProtocol(
                normalizeCompatibilityProfile(profile),
                { kind: 'builtInAgent', agentId: bundledAgentId },
            );
        }
        // An external qualified Agent has no legacy flat Agent id. Preserve the
        // canonical profile default instead of guessing one from its identity.
        return profile.isBuiltIn ? false : true;
    }
    const normalizedTargetV1 = convertBackendTargetRefV2ToV1(readBackendTargetRefV2(target));
    return isProfileCompatibleWithBackendTargetProtocol(normalizeCompatibilityProfile(profile), normalizedTargetV1);
}

export function isProfileCompatibleWithAgent(
    profile: ProfileCompatibilitySummary,
    agentId: AgentId,
): boolean {
    return isProfileCompatibleWithAgentProtocol(normalizeCompatibilityProfile(profile), agentId);
}

export function getProfileEnvironmentVariables(profile: AIBackendProfile): Record<string, string> {
    return getProfileEnvironmentVariablesProtocol(profile);
}

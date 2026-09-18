import type { FeaturesPayloadDelta } from "./types";
import { resolveFriendsPolicyFromEnv } from "@/app/social/friendsPolicy";
import {
    hasDeploymentIdentityProvider,
    resolveDeploymentOAuthProviderStatuses,
} from "@/app/auth/providers/deploymentProviderFeatures";

export function resolveFriendsFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    const friendsPolicy = resolveFriendsPolicyFromEnv(env);
    const oauthProviders = resolveDeploymentOAuthProviderStatuses(env);

    const requiredProviderId = friendsPolicy.requiredIdentityProviderId;
    const providerConfigured = (() => {
        if (!requiredProviderId) return true;

        if (!hasDeploymentIdentityProvider(env, requiredProviderId)) return false;

        const oauthStatus = oauthProviders[requiredProviderId];
        if (!oauthStatus) return true;

        return oauthStatus.configured === true;
    })();
    // Fail-closed: only advertise friends as enabled when there is an available identity path.
    // If username identity is disabled and the required provider isn't configured, clients should hide entry points.
    const enabled = friendsPolicy.enabled && (friendsPolicy.allowUsername || providerConfigured);

    return {
        features: {
            social: {
                friends: {
                    enabled,
                },
            },
        },
        capabilities: {
            social: {
                friends: {
                    allowUsername: friendsPolicy.allowUsername,
                    requiredIdentityProviderId: requiredProviderId,
                },
            },
        },
    };
}

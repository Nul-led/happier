import type { FeaturesPayloadDelta } from "./types";
import { resolveDeploymentOAuthProviderStatuses } from "@/app/auth/providers/deploymentProviderFeatures";

export function resolveOAuthFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    return {
        capabilities: {
            oauth: {
                providers: resolveDeploymentOAuthProviderStatuses(env),
            },
        },
    };
}

import type { AuthMethodModule } from "@/app/auth/methods/types";

import { registerKeyChallengeAuthRoute } from "@/app/api/routes/auth/registerKeyChallengeAuthRoute";
import { readAuthFeatureEnv } from "@/app/features/catalog/readFeatureEnv";

export const keyChallengeAuthMethodModule: AuthMethodModule = Object.freeze({
    id: "key_challenge",
    resolveAuthMethod: ({ env, policy, admission }) => {
        const featureEnv = readAuthFeatureEnv(env);
        const loginEnabled = featureEnv.loginKeyChallengeEnabled;
        const provisionEnabled = loginEnabled && (policy.anonymousSignupEnabled || admission !== undefined);
        return {
            id: "key_challenge",
            actions: [
                { id: "login", enabled: loginEnabled, mode: "keyed" },
                { id: "provision", enabled: provisionEnabled, mode: "keyed" },
            ],
            ui: { displayName: "Device key", iconHint: null },
        };
    },
    registerRoutes: (app) => {
        // Native E2EE password admission shares this protocol. The finalizer
        // admits the method actually proven, independently of route presence.
        registerKeyChallengeAuthRoute(app);
    },
});

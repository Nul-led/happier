import type { AuthMethodActionMode, AuthMethodModule } from "@/app/auth/methods/types";

import { readAuthEmailPasswordFeatureEnv } from "@/app/features/catalog/readFeatureEnv";
import { resolveAllowedAccountProvisionModes } from "@/app/auth/methods/accountProvisionModes";
import { registerNativeEmailPasswordRoutes } from "@/app/api/routes/auth/registerNativeEmailPasswordRoutes";

export const EMAIL_PASSWORD_AUTH_METHOD_ID = "email_password";

/**
 * Native email/password authentication as one `AuthMethodModule`.
 *
 * The module owns only the method's effective action/mode projection. Password
 * hashing, envelopes, prelogin, mail delivery and the native routes belong to
 * their own owners; nothing password-mechanical leaks into the method registry.
 *
 * Account-mode facts come from the canonical encryption/storage policy owner, so
 * provisioning can never imply Plain creation on an E2EE-required Home.
 */
export const emailPasswordAuthMethodModule: AuthMethodModule = Object.freeze({
    id: EMAIL_PASSWORD_AUTH_METHOD_ID,
    accountIdentityProviderId: "email",
    resolveAuthMethod: ({ env }) => {
        const featureEnv = readAuthEmailPasswordFeatureEnv(env);
        const allowedModes = resolveAllowedAccountProvisionModes(env);
        const mode: AuthMethodActionMode =
            allowedModes.length === 2 ? "either" : allowedModes[0] === "plain" ? "keyless" : "keyed";
        const enabled = featureEnv.enabled;
        return {
            id: EMAIL_PASSWORD_AUTH_METHOD_ID,
            actions: [
                {
                    id: "login",
                    enabled,
                    mode,
                    ...(enabled ? {} : { reason: "method_not_enabled" as const }),
                },
                {
                    id: "provision",
                    enabled: enabled && featureEnv.provisionEnabled,
                    mode,
                    ...(enabled
                        ? featureEnv.provisionEnabled
                            ? {}
                            : { reason: "provisioning_not_enabled" as const }
                        : { reason: "method_not_enabled" as const }),
                },
                {
                    id: "connect",
                    enabled,
                    mode,
                    ...(enabled ? {} : { reason: "method_not_enabled" as const }),
                },
            ],
            ui: { displayName: "Email and password", iconHint: null },
        };
    },
    // Self-service admission proves the mailbox before the Account exists.
    mailDependentActions: ["provision"] as const,
    registerRoutes: (app, context) => registerNativeEmailPasswordRoutes(app, {
        ...(context ? {
            isEmailDeliveryReady: context.isEmailDeliveryReady,
            authEmailDelivery: context.authEmailDelivery,
            resolveApplicationLinkTarget: context.resolveApplicationLinkTarget,
        } : {}),
    }),
});

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
        // Account-mode policy decides which Accounts may be *constructed*. An
        // Account that already exists keeps its stored mode, so stamping the
        // narrowed mode on `login`/`connect` would strand every Plain password
        // Account the moment the deployment turns keyless accounts off. This is
        // the same rule the persisted Home-policy narrowing already applies in
        // `applyHomePolicyToAuthMethodDecision`. Keyed password login uses the
        // shared challenge protocol but is admitted as this native method.
        const provisionMode: AuthMethodActionMode =
            allowedModes.length === 2 ? "either" : allowedModes[0] === "plain" ? "keyless" : "keyed";
        const existingAccountMode: AuthMethodActionMode = "either";
        const enabled = featureEnv.enabled;
        return {
            id: EMAIL_PASSWORD_AUTH_METHOD_ID,
            actions: [
                {
                    id: "login",
                    enabled,
                    mode: existingAccountMode,
                    ...(enabled ? {} : { reason: "method_not_enabled" as const }),
                },
                {
                    id: "provision",
                    enabled: enabled && featureEnv.provisionEnabled,
                    mode: provisionMode,
                    ...(enabled
                        ? featureEnv.provisionEnabled
                            ? {}
                            : { reason: "provisioning_not_enabled" as const }
                        : { reason: "method_not_enabled" as const }),
                },
                {
                    id: "connect",
                    enabled,
                    mode: existingAccountMode,
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

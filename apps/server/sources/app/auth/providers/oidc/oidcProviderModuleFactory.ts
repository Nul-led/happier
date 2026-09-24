import type { ProviderModule } from "@/app/auth/providers/providerModules";
import type { AuthProviderFeatures, AuthProviderResolver } from "@/app/auth/providers/types";
import type { AuthPolicy } from "@/app/auth/authPolicy";
import type { OidcAuthProviderInstanceConfig } from "@/app/auth/providers/oidc/oidcProviderConfig";
import type { OutboundIdentityNetworkPolicy } from "@/app/net/outboundIdentityNetworkPolicy";

import { createOidcOAuthProvider } from "@/app/oauth/providers/oidc/oidcOAuthProvider";
import {
    createOidcIdentityProvider,
    type OidcTeamIdentityConnection,
} from "@/app/auth/providers/oidc/oidcIdentityProvider";

export function resolveOidcAuthProviderFeatures(
    instance: Pick<OidcAuthProviderInstanceConfig, "displayName" | "allow" | "storeRefreshToken" | "ui">,
    policy: AuthPolicy,
): AuthProviderFeatures {
    const usersAllowlist = instance.allow.usersAllowlist.length > 0;
    const orgsAllowlist =
        instance.allow.emailDomains.length > 0
        || instance.allow.groupsAny.length > 0
        || instance.allow.groupsAll.length > 0;
    return {
        enabled: true,
        configured: true,
        ui: {
            displayName: instance.displayName,
            iconHint: instance.ui.iconHint ?? "oidc",
            connectButtonColor: instance.ui.buttonColor,
            supportsProfileBadge: false,
        },
        restrictions: {
            usersAllowlist,
            orgsAllowlist,
            orgMatch: instance.allow.groupsAll.length > 0 ? "all" : "any",
        },
        offboarding: {
            enabled: policy.offboarding.enabled,
            intervalSeconds: policy.offboarding.intervalSeconds,
            mode: policy.offboarding.mode,
            source: instance.storeRefreshToken ? "oidc_refresh_token" : "oidc_claims",
        },
    };
}

function createOidcAuthProviderResolver(instance: OidcAuthProviderInstanceConfig): AuthProviderResolver {
    return Object.freeze({
        id: instance.id,
        resolveFeatures: ({ policy }) => resolveOidcAuthProviderFeatures(instance, policy),
        requiresOAuth: true,
        isConfigured: () => true,
        providerKind: "oidc",
    });
}

export function createOidcProviderModule(
    instance: OidcAuthProviderInstanceConfig,
    runtimeFingerprint: string,
    networkPolicy?: OutboundIdentityNetworkPolicy,
    teamConnection?: OidcTeamIdentityConnection,
): ProviderModule {
    return Object.freeze({
        id: instance.id,
        oauth: createOidcOAuthProvider(instance, runtimeFingerprint, networkPolicy, teamConnection),
        identity: createOidcIdentityProvider(instance, runtimeFingerprint, networkPolicy, teamConnection),
        auth: createOidcAuthProviderResolver(instance),
    }) satisfies ProviderModule;
}

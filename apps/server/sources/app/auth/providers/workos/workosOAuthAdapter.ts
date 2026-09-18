import type { WorkOS } from "@workos-inc/node";

import type { TeamIdentityConnectionExternalReference } from "@/app/auth/providers/managed/identityProviderDocuments";
import type { WorkosPlatformConfigResolution } from "@/app/integrations/workos/workosPlatform";

import {
    normalizeAndValidateWorkosProfile,
    type NormalizedWorkosProfile,
} from "./normalizeAndValidateWorkosProfile";

export type WorkosTeamExternalReferenceV1 = Extract<
    TeamIdentityConnectionExternalReference,
    { kind: "workos_sso" }
> & Readonly<{ organizationId: string; connectionId: string }>;

export interface WorkosOAuthAdapterInput {
    providerInstanceId: string;
    enabled: boolean;
    redirectUrl: string;
    externalReference: Readonly<WorkosTeamExternalReferenceV1>;
    platform: WorkosPlatformConfigResolution;
}

export interface WorkosOAuthAdapter {
    id: string;
    resolveStatus: () => Readonly<{ enabled: boolean; configured: boolean }>;
    resolveRedirectUrl: () => string;
    resolveAuthorizeUrl: (input: Readonly<{
        state: string;
        codeChallenge: string;
        codeChallengeMethod: "S256";
    }>) => Promise<string>;
    exchangeCodeForProfile: (input: Readonly<{
        code: string;
        pkceCodeVerifier: string;
    }>) => Promise<Readonly<{
        accessToken: string;
        profile: Readonly<NormalizedWorkosProfile>;
    }>>;
    getLogin: (profile: unknown) => string | null;
    getProviderUserId: (profile: unknown) => string | null;
}

function unavailableCode(input: WorkosOAuthAdapterInput): "workos_platform_unavailable" | "team_identity_not_configured" | null {
    if (!input.platform.available) return "workos_platform_unavailable";
    if (!input.externalReference.organizationId || !input.externalReference.connectionId) {
        return "team_identity_not_configured";
    }
    return null;
}

function requireClient(input: WorkosOAuthAdapterInput): Readonly<{
    client: WorkOS;
    clientId: string;
    connectionId: string;
}> {
    const code = unavailableCode(input);
    if (code) throw new Error(code);
    const platform = input.platform as Extract<WorkosPlatformConfigResolution, { available: true }>;
    return {
        client: platform.client,
        clientId: platform.clientId,
        connectionId: input.externalReference.connectionId!,
    };
}

function requireNormalizedProfile(input: WorkosOAuthAdapterInput, profile: unknown): Readonly<NormalizedWorkosProfile> {
    const connectionId = input.externalReference.connectionId;
    if (!connectionId) throw new Error("team_identity_not_configured");
    const result = normalizeAndValidateWorkosProfile({
        profile,
        expectedBinding: {
            organizationId: input.externalReference.organizationId,
            connectionId,
        },
    });
    if (!result.ok) throw new Error(result.error);
    return result.value;
}

export function createWorkosOAuthAdapter(input: WorkosOAuthAdapterInput): WorkosOAuthAdapter {
    const configured = unavailableCode(input) === null;

    return Object.freeze({
        id: input.providerInstanceId,
        resolveStatus: () => ({ enabled: input.enabled, configured }),
        resolveRedirectUrl: () => input.redirectUrl,
        resolveAuthorizeUrl: async (
            { state, codeChallenge, codeChallengeMethod }:
            Parameters<WorkosOAuthAdapter["resolveAuthorizeUrl"]>[0],
        ) => {
            if (!codeChallenge || codeChallengeMethod !== "S256") throw new Error("invalid_pkce");
            const { client, clientId, connectionId } = requireClient(input);
            return client.sso.getAuthorizationUrl({
                clientId,
                connection: connectionId,
                redirectUri: input.redirectUrl,
                state,
                codeChallenge,
                codeChallengeMethod,
            });
        },
        exchangeCodeForProfile: async (
            { code, pkceCodeVerifier }:
            Parameters<WorkosOAuthAdapter["exchangeCodeForProfile"]>[0],
        ) => {
            if (!pkceCodeVerifier) throw new Error("invalid_pkce");
            const { client, clientId } = requireClient(input);
            const exchange = await client.sso.getProfileAndToken({
                clientId,
                code,
                codeVerifier: pkceCodeVerifier,
            });
            const profile = requireNormalizedProfile(input, exchange.profile);
            return Object.freeze({ accessToken: exchange.accessToken, profile });
        },
        getLogin: (profile: unknown) => {
            try {
                return requireNormalizedProfile(input, profile).email;
            } catch {
                return null;
            }
        },
        getProviderUserId: (profile: unknown) => {
            try {
                return requireNormalizedProfile(input, profile).id;
            } catch {
                return null;
            }
        },
    });
}

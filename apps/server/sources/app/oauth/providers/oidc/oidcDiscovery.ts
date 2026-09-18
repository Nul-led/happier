import * as oidcClient from "openid-client";

import { createOutboundIdentityFetch, type OutboundIdentityFetch } from "@/app/net/outboundIdentityFetch";
import {
    evaluateOutboundUrl,
    OutboundIdentityEndpointError,
    redactEndpoint,
    type OutboundIdentityNetworkPolicy,
} from "@/app/net/outboundIdentityNetworkPolicy";
import type { OidcAuthProviderInstanceConfig } from "@/app/auth/providers/oidc/oidcProviderConfig";
import { isLoopbackHostname } from "@/utils/network/urlSafety";

type CachedDiscovery = Readonly<{
    runtimeFingerprint: string;
    issuer: string;
    clientId: string;
    config: oidcClient.Configuration;
    outbound: OutboundIdentityFetch;
    expiresAtMs: number;
}>;

const DISCOVERY_TTL_MS = 10 * 60 * 1000;
/** Discovery/JWKS/token/UserInfo documents are small; this only has to stop an unbounded body. */
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_HEADER_BYTES = 32 * 1024;

const discoveryCache = new Map<string, CachedDiscovery>();

/**
 * Outbound policy for a deployment-configured (env/file) OIDC provider.
 *
 * The deployment operator already chose the issuer, so addresses stay unfiltered
 * and every released private-network issuer keeps working. Scheme, peer pinning,
 * redirect rejection, response bounds, and the timeout still apply, and plaintext
 * HTTP remains restricted to loopback exactly as `oidcProviderConfig` validates it.
 */
export function deploymentConfiguredOidcNetworkPolicy(
    instance: OidcAuthProviderInstanceConfig,
): OutboundIdentityNetworkPolicy {
    return Object.freeze({
        address: Object.freeze({ kind: "deploymentConfigured" as const }),
        allowedPorts: "any" as const,
        allowLoopbackHttp: true,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        maxHeaderBytes: MAX_HEADER_BYTES,
        timeoutMs: instance.httpTimeoutSeconds * 1000,
    });
}

function evictDiscovery(providerId: string): void {
    const cached = discoveryCache.get(providerId);
    if (!cached) return;
    discoveryCache.delete(providerId);
    void cached.outbound.close();
}

export async function discoverOidcConfiguration(
    instance: OidcAuthProviderInstanceConfig,
    runtimeFingerprint: string,
    networkPolicy: OutboundIdentityNetworkPolicy = deploymentConfiguredOidcNetworkPolicy(instance),
): Promise<oidcClient.Configuration> {
    const cached = discoveryCache.get(instance.id);
    const now = Date.now();
    if (cached?.runtimeFingerprint === runtimeFingerprint) {
        if (cached.issuer !== instance.issuer || cached.clientId !== instance.clientId) {
            evictDiscovery(instance.id);
            throw new Error("oidc_runtime_fingerprint_mismatch");
        }
        if (cached.expiresAtMs > now) return cached.config;
    }
    evictDiscovery(instance.id);

    let issuer: URL;
    try {
        issuer = new URL(instance.issuer);
    } catch {
        throw new OutboundIdentityEndpointError(
            "outbound_scheme_forbidden",
            "<unparseable-issuer>",
            "issuer is not a valid absolute URL",
        );
    }

    // The connector owns the loopback-development decision. No discovery, token, or
    // UserInfo call may independently opt out of TLS or address validation.
    const allowsInsecureIssuer =
        issuer.protocol === "http:" && networkPolicy.allowLoopbackHttp && isLoopbackHostname(issuer.hostname);

    const outbound = createOutboundIdentityFetch({ policy: networkPolicy });
    const execute: Array<(config: oidcClient.Configuration) => void> = [oidcClient.enableNonRepudiationChecks];
    if (allowsInsecureIssuer) execute.push(oidcClient.allowInsecureRequests);

    const options: oidcClient.DiscoveryRequestOptions = {
        timeout: instance.httpTimeoutSeconds,
        // Retained by `openid-client` for JWKS, token, refresh, and UserInfo requests.
        [oidcClient.customFetch]: outbound.fetch as oidcClient.CustomFetch,
        execute,
    };

    let config: oidcClient.Configuration;
    try {
        config = await oidcClient.discovery(
            issuer,
            instance.clientId,
            instance.clientSecret,
            instance.clientAuthenticationMethod === "client_secret_basic"
                ? oidcClient.ClientSecretBasic(instance.clientSecret)
                : oidcClient.ClientSecretPost(instance.clientSecret),
            options,
        );
        assertDiscoveredOidcMetadata(config, instance.issuer, networkPolicy);
    } catch (error) {
        await outbound.close();
        throw error;
    }

    discoveryCache.set(instance.id, {
        runtimeFingerprint, issuer: instance.issuer, clientId: instance.clientId,
        config, outbound, expiresAtMs: now + DISCOVERY_TTL_MS,
    });
    return config;
}

function assertDiscoveredOidcMetadata(
    config: oidcClient.Configuration,
    expectedIssuer: string,
    networkPolicy: OutboundIdentityNetworkPolicy,
): void {
    const metadata = config.serverMetadata();
    if (metadata.issuer !== expectedIssuer) {
        throw new Error("oidc_issuer_mismatch");
    }
    if (
        !Array.isArray(metadata.response_types_supported)
        || !metadata.response_types_supported.includes("code")
    ) {
        throw new Error("oidc_authorization_code_unsupported");
    }
    if (
        !Array.isArray(metadata.code_challenge_methods_supported)
        || !metadata.code_challenge_methods_supported.includes("S256")
    ) {
        throw new Error("oidc_pkce_s256_unsupported");
    }

    if (typeof metadata.authorization_endpoint !== "string") {
        throw new OutboundIdentityEndpointError(
            "outbound_host_forbidden",
            "<missing-authorization-endpoint>",
            "discovery did not return an authorization endpoint",
        );
    }

    let authorizationEndpoint: URL;
    try {
        authorizationEndpoint = new URL(metadata.authorization_endpoint);
    } catch {
        throw new OutboundIdentityEndpointError(
            "outbound_scheme_forbidden",
            "<unparseable-authorization-endpoint>",
            "authorization endpoint is not a valid absolute URL",
        );
    }
    const decision = evaluateOutboundUrl(networkPolicy, authorizationEndpoint);
    if (!decision.allowed) {
        throw new OutboundIdentityEndpointError(
            decision.code,
            redactEndpoint(authorizationEndpoint),
            decision.reason,
        );
    }

    // Discovery metadata can introduce additional server-fetch targets after
    // the well-known request. Validate every one up front so enabling a
    // provider cannot succeed with a token/JWKS/UserInfo endpoint that would
    // only fail (or disclose policy details) on a later OAuth operation. The
    // custom fetch remains the final enforcement boundary for redirects,
    // rebinding, and every actual request.
    for (const [name, rawEndpoint] of [
        ["token_endpoint", metadata.token_endpoint],
        ["jwks_uri", metadata.jwks_uri],
        ["userinfo_endpoint", metadata.userinfo_endpoint],
    ] as const) {
        if (rawEndpoint === undefined) continue;
        if (typeof rawEndpoint !== "string") {
            throw new OutboundIdentityEndpointError(
                "outbound_scheme_forbidden",
                `<invalid-${name}>`,
                `${name} is not a valid URL`,
            );
        }
        let endpoint: URL;
        try {
            endpoint = new URL(rawEndpoint);
        } catch {
            throw new OutboundIdentityEndpointError(
                "outbound_scheme_forbidden",
                `<unparseable-${name}>`,
                `${name} is not a valid absolute URL`,
            );
        }
        const endpointDecision = evaluateOutboundUrl(networkPolicy, endpoint);
        if (!endpointDecision.allowed) {
            throw new OutboundIdentityEndpointError(
                endpointDecision.code,
                redactEndpoint(endpoint),
                endpointDecision.reason,
            );
        }
    }
}

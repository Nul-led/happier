import { parseBooleanEnv, parseIntEnv, parseOptionalBooleanEnv } from "@/config/env";
import { resolveAuthProviderInstancesFromEnv } from "@/app/auth/providers/oidc/oidcProviderConfig";

export type AuthOffboardingMode = "per-request-cache";

export type AuthKeyChallengeV2Policy = Readonly<{
    ordinaryHomeRequired: boolean;
}>;

export function resolveAuthKeyChallengeV2Policy(
    env: NodeJS.ProcessEnv,
): AuthKeyChallengeV2Policy {
    const configured = env.HAPPIER_AUTH_REQUIRE_KEY_CHALLENGE_V2;
    return Object.freeze({
        ordinaryHomeRequired: parseBooleanEnv(configured, false),
    });
}

export function resolveAuthKeyChallengeV2Requirement(
    env: NodeJS.ProcessEnv,
): boolean {
    return resolveAuthKeyChallengeV2Policy(env).ordinaryHomeRequired;
}

export type AuthPolicy = Readonly<{
    anonymousSignupEnabled: boolean;
    signupProviders: readonly string[];
    requiredLoginProviders: readonly string[];

    offboarding: Readonly<{
        enabled: boolean;
        strict: boolean;
        intervalSeconds: number;
        mode: AuthOffboardingMode;
    }>;
}>;

/**
 * Returns true only for a recognized, explicitly disabled anonymous-signup
 * setting. This is stricter than the effective signup policy because callers
 * that enable non-loopback exposure must not treat an unset or malformed
 * value as proof that signup has been closed.
 */
export function isAnonymousSignupExplicitlyDisabled(
    env: NodeJS.ProcessEnv,
): boolean {
    return parseOptionalBooleanEnv(env.AUTH_ANONYMOUS_SIGNUP_ENABLED) === false;
}

function parseCsvList(raw: string | undefined): string[] {
    if (typeof raw !== "string") return [];
    return raw
        .split(/[,\s]+/g)
        .map((s) => s.trim())
        .filter(Boolean);
}

function parseProvidersList(raw: string | undefined): string[] {
    return parseCsvList(raw).map((s) => s.toLowerCase());
}

function hasAnyGitHubOrgAllowlistConfigured(env: NodeJS.ProcessEnv): boolean {
    const raw = (env.AUTH_GITHUB_ALLOWED_ORGS ?? "").toString();
    return raw.trim().length > 0;
}

function hasAnyOidcAllowlistsConfigured(env: NodeJS.ProcessEnv): boolean {
    const result = resolveAuthProviderInstancesFromEnv(env);
    for (const instance of result.instances) {
        if (
            instance.allow.usersAllowlist.length > 0 ||
            instance.allow.emailDomains.length > 0 ||
            instance.allow.groupsAny.length > 0 ||
            instance.allow.groupsAll.length > 0
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Default `AUTH_OFFBOARDING_ENABLED` behavior:
 * - If any provider allowlists are configured, offboarding defaults to enabled.
 * - Operators can always override this with `AUTH_OFFBOARDING_ENABLED`.
 *
 * Offboarding controls the *re-check schedule* for allowlist-based eligibility.
 * When allowlists exist but offboarding is disabled, users may not be revoked
 * promptly when their upstream membership changes.
 */
function hasAnyOffboardingRestrictionsConfigured(env: NodeJS.ProcessEnv): boolean {
    return hasAnyGitHubOrgAllowlistConfigured(env) || hasAnyOidcAllowlistsConfigured(env);
}

/**
 * Canonical current-policy decision for completing an external OAuth account
 * authentication with `providerId`.
 *
 * Finalizers read this immediately from current server policy rather than from
 * the pending continuation, so a provider removed from `AUTH_SIGNUP_PROVIDERS`
 * after authorization start can no longer complete an in-flight continuation.
 * A blank or unlisted provider fails closed.
 */
export function isAuthSignupProviderEnabled(
    env: NodeJS.ProcessEnv,
    providerId: string,
): boolean {
    const normalized = providerId.trim().toLowerCase();
    if (!normalized) return false;
    return resolveAuthPolicyFromEnv(env).signupProviders.includes(normalized);
}

export function resolveAuthPolicyFromEnv(env: NodeJS.ProcessEnv): AuthPolicy {
    const anonymousSignupEnabled = parseBooleanEnv(env.AUTH_ANONYMOUS_SIGNUP_ENABLED, true);
    const signupProviders = Object.freeze(parseProvidersList(env.AUTH_SIGNUP_PROVIDERS));
    const requiredLoginProviders = Object.freeze(parseProvidersList(env.AUTH_REQUIRED_LOGIN_PROVIDERS));

    const restrictionsExist = hasAnyOffboardingRestrictionsConfigured(env);
    const defaultOffboardingEnabled = restrictionsExist;
    const offboardingEnabled = parseBooleanEnv(env.AUTH_OFFBOARDING_ENABLED, defaultOffboardingEnabled);
    const offboardingStrict = parseBooleanEnv(env.AUTH_OFFBOARDING_STRICT, false);
    const intervalSeconds = parseIntEnv(env.AUTH_OFFBOARDING_INTERVAL_SECONDS, 86400, { min: 60, max: 86400 });
    const mode: AuthOffboardingMode = "per-request-cache";

    return Object.freeze({
        anonymousSignupEnabled,
        signupProviders,
        requiredLoginProviders,
        offboarding: Object.freeze({
            enabled: offboardingEnabled,
            strict: offboardingStrict,
            intervalSeconds,
            mode,
        }),
    });
}

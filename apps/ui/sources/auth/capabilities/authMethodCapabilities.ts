import type { FeaturesResponse } from '@happier-dev/protocol';

type AuthMethodActionMode = 'keyed' | 'keyless' | 'either';

type AuthMethodAction = Readonly<{
    id: 'login' | 'provision' | 'connect';
    enabled: boolean;
    mode: AuthMethodActionMode;
}>;

type AuthMethod = Readonly<{
    id: string;
    actions?: readonly AuthMethodAction[];
}>;

export type AuthenticationMethodCapabilities = Readonly<{
    usesStructuredMethods: boolean;
    legacyEnabledSignupMethodIds: readonly string[];
    legacyEnabledLoginMethodIds: readonly string[];
    anonymousProvisionAvailable: boolean;
    keyChallengeV2Available: boolean;
    keyedProvisionProviderIds: readonly string[];
    configuredKeyedProvisionProviderIds: readonly string[];
    configuredEnabledKeyedProvisionProviderIds: readonly string[];
    keylessLoginMethodIds: readonly string[];
    configuredKeylessProviderIds: readonly string[];
}>;

export function normalizeAuthenticationProviderId(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

function hasEnabledAction(
    method: AuthMethod | null,
    actionId: 'login' | 'provision' | 'connect',
    modes: readonly AuthMethodActionMode[],
): boolean {
    const actions = Array.isArray(method?.actions) ? method.actions : [];
    return actions.some((action) => action?.enabled === true && action.id === actionId && modes.includes(action.mode));
}

function resolveMethodById(methods: readonly AuthMethod[], providerId: string): AuthMethod | null {
    const normalized = normalizeAuthenticationProviderId(providerId);
    if (!normalized) return null;
    return methods.find((method) => normalizeAuthenticationProviderId(method.id) === normalized) ?? null;
}

function uniqueProviderIds(values: readonly unknown[]): readonly string[] {
    return [...new Set(values.map(normalizeAuthenticationProviderId).filter(Boolean))];
}

/**
 * Pure projection of the server's authentication-method capability. Ordinary Home consumers
 * retain the released signup/login fallback while stricter explicit-endpoint consumers can use
 * the configured/enabled structured projections without reinterpreting the wire payload.
 */
export function projectAuthenticationMethodCapabilities(
    features: FeaturesResponse | null,
): AuthenticationMethodCapabilities {
    const authMethodsRaw = features?.capabilities?.auth?.methods ?? [];
    const authMethods = Array.isArray(authMethodsRaw) ? (authMethodsRaw as readonly AuthMethod[]) : [];
    const usesStructuredMethods = authMethods.length > 0;
    const legacyEnabledSignupMethodIds = uniqueProviderIds(
        (features?.capabilities?.auth?.signup?.methods ?? [])
            .filter((method) => method.enabled === true)
            .map((method) => method.id),
    );
    const legacyEnabledLoginMethodIds = uniqueProviderIds(
        (features?.capabilities?.auth?.login?.methods ?? [])
            .filter((method) => method.enabled === true)
            .map((method) => method.id),
    );

    const keyedProvisionProviderIds = usesStructuredMethods
        ? uniqueProviderIds(authMethods
            .map((method) => method.id)
            .filter((id) => {
                const normalized = normalizeAuthenticationProviderId(id);
                return normalized !== 'key_challenge'
                    && normalized !== 'mtls'
                    && hasEnabledAction(resolveMethodById(authMethods, normalized), 'provision', ['keyed', 'either']);
            }))
        : legacyEnabledSignupMethodIds.filter((id) => id !== 'anonymous');

    const keylessLoginMethodIds = usesStructuredMethods
        ? uniqueProviderIds(authMethods
            .map((method) => method.id)
            .filter((id) => {
                const normalized = normalizeAuthenticationProviderId(id);
                return normalized !== 'key_challenge'
                    && hasEnabledAction(resolveMethodById(authMethods, normalized), 'login', ['keyless', 'either']);
            }))
        : legacyEnabledLoginMethodIds.filter((id) => id !== 'key_challenge');

    const oauthProviders = features?.capabilities?.oauth?.providers ?? {};
    const configuredKeyedProvisionProviderIds = keyedProvisionProviderIds.filter(
        (id) => oauthProviders[id]?.configured === true,
    );
    const configuredEnabledKeyedProvisionProviderIds = keyedProvisionProviderIds.filter(
        (id) => oauthProviders[id]?.configured === true && oauthProviders[id]?.enabled === true,
    );
    const configuredKeylessProviderIds = keylessLoginMethodIds.filter(
        (id) => id !== 'mtls' && oauthProviders[id]?.configured === true,
    );

    return {
        usesStructuredMethods,
        legacyEnabledSignupMethodIds,
        legacyEnabledLoginMethodIds,
        anonymousProvisionAvailable: usesStructuredMethods
            ? hasEnabledAction(resolveMethodById(authMethods, 'key_challenge'), 'provision', ['keyed', 'either'])
            : legacyEnabledSignupMethodIds.includes('anonymous'),
        keyChallengeV2Available: features?.capabilities?.auth?.keyChallenge?.v2 === true,
        keyedProvisionProviderIds,
        configuredKeyedProvisionProviderIds,
        configuredEnabledKeyedProvisionProviderIds,
        keylessLoginMethodIds,
        configuredKeylessProviderIds,
    };
}

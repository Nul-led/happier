import type { AuthEntryActionV1, AuthEntryProjectionV1, FeaturesResponse } from '@happier-dev/protocol';
import {
    projectAuthenticationMethodCatalog,
    projectAuthenticationMethodCatalogFromAuthEntry,
} from '@happier-dev/cli-common/authentication/authMethodCatalog';
import type { ProjectedAuthenticationCatalog } from '@happier-dev/cli-common/authentication/authMethodCatalog';
import type { ProjectedAuthenticationAction, ProjectedAuthenticationMethod } from '@happier-dev/cli-common/authentication/authMethodCatalog';

/**
 * The email/password destination is exhaustive by action: `login`, `provision`
 * and `connect` each have their own controller. Dropping an action here would
 * silently strand it in the generic external-execution tail (L02-R28).
 */
export type EmailPasswordEntryAction = 'login' | 'provision' | 'connect';

export type HomeAuthenticationExecution =
    | Readonly<{ kind: 'generated_key' }>
    | Readonly<{ kind: 'key_entry' }>
    | Readonly<{ kind: 'mtls' }>
    | Readonly<{ kind: 'email_password'; action: EmailPasswordEntryAction; mode: 'keyed' | 'keyless' | 'either' }>
    | Readonly<{ kind: 'oauth'; providerId: string; mode: 'keyed' | 'keyless' }>;

function isEmailPasswordEntryAction(value: string): value is EmailPasswordEntryAction {
    return value === 'login' || value === 'provision' || value === 'connect';
}

/**
 * Account modes a Home admits for a new email/password Account. The entry
 * projection carries Home policy in the action mode: `keyed` means E2EE only,
 * `keyless` means Plain only, and `either` leaves the protection choice to the
 * person creating the Account.
 */
export function resolveEmailPasswordProvisionModes(
    mode: 'keyed' | 'keyless' | 'either',
): readonly ('plain' | 'e2ee')[] {
    if (mode === 'keyed') return ['e2ee'];
    if (mode === 'keyless') return ['plain'];
    return ['plain', 'e2ee'];
}

export type HomeAuthenticationAction = Readonly<{
    method: ProjectedAuthenticationMethod;
    action: ProjectedAuthenticationAction;
    execution: HomeAuthenticationExecution;
}>;

type AuthEntryAuthenticationAction = Extract<AuthEntryActionV1, { kind: 'authenticate' }>;

function authenticationActionsFrom(
    actions: readonly AuthEntryActionV1[],
): readonly AuthEntryAuthenticationAction[] {
    return actions.filter((action): action is AuthEntryAuthenticationAction => action.kind === 'authenticate');
}

export type AuthenticationMethodCapabilities = Readonly<{
    catalog: ProjectedAuthenticationCatalog;
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
    authenticationActions: readonly HomeAuthenticationAction[];
}>;

export function normalizeAuthenticationProviderId(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

function uniqueProviderIds(values: readonly unknown[]): readonly string[] {
    return [...new Set(values.map(normalizeAuthenticationProviderId).filter(Boolean))];
}

export function projectAuthEntryMethodCapabilities(
    projection: Extract<AuthEntryProjectionV1, { state: 'ready' | 'admission_required' }>,
): AuthenticationMethodCapabilities {
    const catalog = projectAuthenticationMethodCatalogFromAuthEntry(projection);
    const methods = new Map(catalog.methods.map((method) => [method.id, method]));
    const authenticationActions = authenticationActionsFrom(projection.actions).flatMap((row): HomeAuthenticationAction[] => {
        const method = methods.get(normalizeAuthenticationProviderId(row.methodId));
        if (!method) return [];
        const action: ProjectedAuthenticationAction = { id: row.action, mode: row.mode };
        if (method.id === 'key_challenge') {
            if (row.action === 'provision' && (row.mode === 'keyed' || row.mode === 'either')) {
                return [{ method, action, execution: { kind: 'generated_key' } }];
            }
            if (row.action === 'login' && (row.mode === 'keyed' || row.mode === 'either')) {
                return [{ method, action, execution: { kind: 'key_entry' } }];
            }
            return [];
        }
        if (method.id === 'mtls') {
            return row.action === 'login' && (row.mode === 'keyless' || row.mode === 'either')
                ? [{ method, action, execution: { kind: 'mtls' } }]
                : [];
        }
        if (method.id === 'email_password') {
            return isEmailPasswordEntryAction(row.action)
                ? [{ method, action, execution: { kind: 'email_password', action: row.action, mode: row.mode } }]
                : [];
        }
        // `connect` attaches an external method to the caller's existing
        // Account — the shape a Team identity connection is projected as. It
        // belongs to the same OAuth execution as `login`/`provision`, so this
        // projector owns it too rather than leaving the Team entry surface to
        // rebuild the execution itself.
        if (row.action !== 'login' && row.action !== 'provision' && row.action !== 'connect') return [];
        // An unconstrained mode is decided once, here: a keyless login reuses
        // the Home's plain credential, while provisioning a new Account and
        // attaching a method to an existing one both carry key material.
        const mode = row.mode === 'either'
            ? row.action === 'login' ? 'keyless' : 'keyed'
            : row.mode;
        return [{ method, action, execution: { kind: 'oauth', providerId: method.id, mode } }];
    });
    const keyedProvisionProviderIds = uniqueProviderIds(authenticationActions.flatMap(({ method, action }) => (
        method.id !== 'key_challenge' && method.id !== 'mtls' && method.id !== 'email_password'
        && action.id === 'provision' && (action.mode === 'keyed' || action.mode === 'either')
            ? [method.id]
            : []
    )));
    const keylessLoginMethodIds = uniqueProviderIds(authenticationActions.flatMap(({ method, action }) => (
        method.id !== 'key_challenge' && method.id !== 'email_password'
        && action.id === 'login' && (action.mode === 'keyless' || action.mode === 'either')
            ? [method.id]
            : []
    )));
    return {
        catalog,
        usesStructuredMethods: true,
        legacyEnabledSignupMethodIds: [],
        legacyEnabledLoginMethodIds: [],
        anonymousProvisionAvailable: authenticationActions.some(({ method, action }) => (
            method.id === 'key_challenge' && action.id === 'provision'
        )),
        keyChallengeV2Available: false,
        keyedProvisionProviderIds,
        configuredKeyedProvisionProviderIds: keyedProvisionProviderIds,
        configuredEnabledKeyedProvisionProviderIds: keyedProvisionProviderIds,
        keylessLoginMethodIds,
        configuredKeylessProviderIds: keylessLoginMethodIds.filter((id) => id !== 'mtls'),
        authenticationActions,
    };
}

/**
 * Pure projection of the server's authentication-method capability. Ordinary Home consumers
 * retain the released signup/login fallback while stricter explicit-endpoint consumers can use
 * the configured/enabled structured projections without reinterpreting the wire payload.
 */
export function projectAuthenticationMethodCapabilities(
    features: FeaturesResponse | null,
): AuthenticationMethodCapabilities {
    const catalog = projectAuthenticationMethodCatalog(features ?? {});
    const usesStructuredMethods = catalog.provenance !== 'legacy';
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
        ? uniqueProviderIds(catalog.methods
            .filter((method) => method.id !== 'key_challenge' && method.id !== 'mtls' && method.id !== 'email_password'
                && method.enabledActions.some((action) => action.id === 'provision' && (action.mode === 'keyed' || action.mode === 'either')))
            .map((method) => method.id))
        : legacyEnabledSignupMethodIds.filter((id) => id !== 'anonymous');

    const keylessLoginMethodIds = usesStructuredMethods
        ? uniqueProviderIds(catalog.methods
            .filter((method) => method.id !== 'key_challenge' && method.id !== 'email_password'
                && method.enabledActions.some((action) => action.id === 'login' && (action.mode === 'keyless' || action.mode === 'either')))
            .map((method) => method.id))
        : legacyEnabledLoginMethodIds.filter((id) => id !== 'key_challenge');

    const oauthProviders = features?.capabilities?.oauth?.providers ?? {};
    const configuredKeyedProvisionProviderIds = usesStructuredMethods
        ? keyedProvisionProviderIds
        : keyedProvisionProviderIds.filter((id) => oauthProviders[id]?.configured === true);
    const configuredEnabledKeyedProvisionProviderIds = usesStructuredMethods
        ? keyedProvisionProviderIds
        : keyedProvisionProviderIds.filter(
            (id) => oauthProviders[id]?.configured === true && oauthProviders[id]?.enabled === true,
        );
    const configuredKeylessProviderIds = usesStructuredMethods
        ? keylessLoginMethodIds.filter((id) => id !== 'mtls')
        : keylessLoginMethodIds.filter((id) => id !== 'mtls' && oauthProviders[id]?.configured === true);
    const authenticationActions = catalog.methods.flatMap((method): HomeAuthenticationAction[] => {
        const methodId = normalizeAuthenticationProviderId(method.id);
        if (methodId === 'key_challenge') {
            return method.enabledActions.flatMap((action): HomeAuthenticationAction[] => {
                if (action.mode !== 'keyed' && action.mode !== 'either') return [];
                if (action.id === 'provision') return [{ method, action, execution: { kind: 'generated_key' } }];
                if (action.id === 'login') return [{ method, action, execution: { kind: 'key_entry' } }];
                return [];
            });
        }
        if (methodId === 'mtls') {
            return method.enabledActions.flatMap((action): HomeAuthenticationAction[] => (
                action.id === 'login' && (action.mode === 'keyless' || action.mode === 'either')
                    ? [{ method, action, execution: { kind: 'mtls' } }]
                    : []
            ));
        }
        if (methodId === 'email_password') {
            return method.enabledActions.flatMap((action): HomeAuthenticationAction[] => (
                isEmailPasswordEntryAction(action.id)
                    ? [{ method, action, execution: { kind: 'email_password', action: action.id, mode: action.mode } }]
                    : []
            ));
        }
        if (!usesStructuredMethods && oauthProviders[methodId]?.configured !== true) return [];
        return method.enabledActions.flatMap((action): HomeAuthenticationAction[] => {
            if (action.id !== 'login' && action.id !== 'provision') return [];
            const mode = action.mode === 'either'
                ? action.id === 'provision' ? 'keyed' : 'keyless'
                : action.mode;
            return [{ method, action, execution: { kind: 'oauth', providerId: methodId, mode } }];
        });
    });

    return {
        catalog,
        usesStructuredMethods,
        legacyEnabledSignupMethodIds,
        legacyEnabledLoginMethodIds,
        anonymousProvisionAvailable: usesStructuredMethods
            ? catalog.methods.some((method) => method.id === 'key_challenge'
                && method.enabledActions.some((action) => action.id === 'provision' && (action.mode === 'keyed' || action.mode === 'either')))
            : legacyEnabledSignupMethodIds.includes('anonymous'),
        keyChallengeV2Available: features?.capabilities?.auth?.keyChallenge?.v2 === true,
        keyedProvisionProviderIds,
        configuredKeyedProvisionProviderIds,
        configuredEnabledKeyedProvisionProviderIds,
        keylessLoginMethodIds,
        configuredKeylessProviderIds,
        authenticationActions,
    };
}

import type {
    AccountProvisionMode,
    AuthMethod,
    AuthMethodActionId,
    AuthMethodUnavailableReason,
    EffectiveAuthMethodAction,
} from "@/app/auth/methods/types";
import type { HomeAuthenticationPolicyReadV1 } from "@happier-dev/protocol";

import { resolveAuthPolicyFromEnv } from "@/app/auth/authPolicy";
import { resolveAuthMethodRegistry } from "@/app/auth/methods/registry";
import {
    resolveAllowedAccountProvisionModes,
    resolveRecommendedAccountProvisionMode,
} from "@/app/auth/methods/accountProvisionModes";
import { resolveDeploymentAuthProviderFeatures } from "@/app/auth/providers/deploymentProviderFeatures";
import { resolveKeylessAutoProvisionEligibility } from "@/app/auth/keyless/resolveKeylessAutoProvisionEligibility";
import { resolveKeylessAccountsEnabled } from "@/app/features/e2ee/resolveKeylessAccountsEnabled";
import { readAuthOauthKeylessFeatureEnv } from "@/app/features/catalog/readFeatureEnv";

export type EffectiveAuthMethodDecision = Readonly<{
    id: string;
    actions: readonly EffectiveAuthMethodAction[];
    allowedProvisionModes: readonly AccountProvisionMode[];
    recommendedProvisionMode: AccountProvisionMode | null;
    ui?: AuthMethod["ui"];
}>;

export type EffectiveAuthMethodInputs = Readonly<{
    env: NodeJS.ProcessEnv;
    /** Persisted Home narrowing. Omitted means the deployment policy is inherited. */
    homeAuthenticationPolicy?: HomeAuthenticationPolicyReadV1;
    /**
     * Transactional-mail readiness from the composed `AuthEmailDelivery`
     * boundary. When readiness is undetermined, mail-dependent actions resolve
     * disabled so the server never advertises an action its request boundary
     * would reject.
     */
    emailDeliveryReady?: boolean;
    /** A server-validated bounded Team source may admit provisioning under a closed Home. */
    admission?: Readonly<{
        kind: "team_invitation" | "team_provisioned_identity" | "team_jit_identity";
    }>;
}>;

/**
 * Method IDs the supported released 0.2 web/mobile/desktop clients would
 * misclassify as an external OAuth provider, routing them to
 * `/v1/auth/external/<id>/params`.
 *
 * This list is the exact input to the `/v1/features` compatibility subset. Its
 * producers are the effective decisions below; its consumers are those clients'
 * existing auth-capability paths. Remove an entry only when no supported
 * stable/preview artifact with that behavior remains.
 */
export const OLD_CLIENT_UNSAFE_AUTH_METHOD_IDS: readonly string[] = Object.freeze(["email_password"]);

function normalizeId(value: unknown): string {
    return String(value ?? "").trim().toLowerCase();
}

function narrowForMailReadiness(
    actions: readonly EffectiveAuthMethodAction[],
    mailDependentActions: readonly AuthMethodActionId[] | undefined,
    emailDeliveryReady: boolean | undefined,
): readonly EffectiveAuthMethodAction[] {
    if (!mailDependentActions || mailDependentActions.length === 0) return actions;
    if (emailDeliveryReady === true) return actions;
    return actions.map((action) =>
        action.enabled && mailDependentActions.includes(action.id)
            ? { ...action, enabled: false, reason: "email_delivery_unavailable" as const }
            : action,
    );
}

export type ProviderAuthMethodActionInput = Readonly<{
    id: string;
    enabled: boolean;
    configured: boolean;
    /** The one row the provider's owner decides: keyed (E2EE) fresh-Account provisioning. */
    keyedProvision: Readonly<{ enabled: boolean; reason?: AuthMethodUnavailableReason }>;
}>;

/**
 * The one OAuth provider action table. Deployment-contributed and managed
 * providers share every row — `connect`, keyed `provision`, keyless `login`,
 * keyless `provision` — and differ only in who decides keyed provisioning, so
 * that predicate is an input rather than a second copy of the table. A provider
 * that is disabled or unconfigured offers nothing.
 */
export function createProviderAuthMethodActionTable(
    env: NodeJS.ProcessEnv,
): (input: ProviderAuthMethodActionInput) => readonly EffectiveAuthMethodAction[] {
    const keyless = readAuthOauthKeylessFeatureEnv(env);
    const keylessAccountsEnabled = resolveKeylessAccountsEnabled(env);
    const keylessAutoProvisionEligible = resolveKeylessAutoProvisionEligibility(env).ok;
    return (input) => {
        const available = input.enabled && input.configured;
        const keylessLoginEnabled = available
            && keylessAccountsEnabled
            && keyless.enabled
            && keyless.providers.includes(normalizeId(input.id));
        return Object.freeze([
            { id: "connect", enabled: available, mode: "either" },
            {
                id: "provision",
                enabled: available && input.keyedProvision.enabled,
                mode: "keyed",
                ...(!input.keyedProvision.enabled && input.keyedProvision.reason
                    ? { reason: input.keyedProvision.reason }
                    : {}),
            },
            { id: "login", enabled: keylessLoginEnabled, mode: "keyless" },
            {
                id: "provision",
                enabled: keylessLoginEnabled && keyless.autoProvision && keylessAutoProvisionEligible,
                mode: "keyless",
            },
        ]);
    };
}

function actionHasPermittedAccountMode(
    action: EffectiveAuthMethodAction,
    permittedModes: readonly AccountProvisionMode[],
): boolean {
    if (action.mode === "either") return permittedModes.length > 0;
    return permittedModes.includes(action.mode === "keyed" ? "e2ee" : "plain");
}

/** Applies the persisted Home document only as a narrowing of a deployment-backed decision. */
export function narrowAuthMethodDecisionForHomePolicy(
    decision: EffectiveAuthMethodDecision,
    homePolicy: HomeAuthenticationPolicyReadV1 | undefined,
    admission?: EffectiveAuthMethodInputs["admission"],
): EffectiveAuthMethodDecision {
    if (!homePolicy || homePolicy.status === "inherited") return decision;
    if (homePolicy.status === "unreadable") {
        return {
            ...decision,
            actions: decision.actions.map((action) => ({
                ...action,
                enabled: false,
                reason: "method_not_enabled" as const,
            })),
            allowedProvisionModes: [],
            recommendedProvisionMode: null,
        };
    }

    const policy = homePolicy.policy;
    const enabledMethodIds = policy.enabledMethodIds?.map(normalizeId);
    const methodEnabled = !enabledMethodIds || enabledMethodIds.includes(normalizeId(decision.id));
    const allowedProvisionModes = policy.permittedAccountModes
        ? decision.allowedProvisionModes.filter((mode) => policy.permittedAccountModes!.includes(mode))
        : decision.allowedProvisionModes;
    const recommendedProvisionMode = policy.recommendedProvisioningMode
        ? (allowedProvisionModes.includes(policy.recommendedProvisioningMode)
            ? policy.recommendedProvisioningMode
            : null)
        : (decision.recommendedProvisionMode && allowedProvisionModes.includes(decision.recommendedProvisionMode)
            ? decision.recommendedProvisionMode
            : allowedProvisionModes.length === 1 ? allowedProvisionModes[0]! : null);

    return {
        ...decision,
        actions: decision.actions.map((action) => {
            if (!action.enabled) return action;
            if (!methodEnabled) return { ...action, enabled: false, reason: "method_not_enabled" as const };
            // Persisted permitted Account modes govern construction of new
            // Accounts only. Existing Accounts retain their stored mode, so
            // applying this narrowing to login/connect would strand a valid
            // Account merely because the Home later changed its provisioning
            // policy.
            if (action.id === "provision" && !actionHasPermittedAccountMode(action, allowedProvisionModes)) {
                return { ...action, enabled: false, reason: "account_mode_unavailable" as const };
            }
            if (action.id === "provision" && policy.admission && policy.admission !== "self_service"
                && !(admission && policy.admission === "invitation_only")) {
                return { ...action, enabled: false, reason: "provisioning_not_enabled" as const };
            }
            if (action.id === "provision" && action.mode === "either" && allowedProvisionModes.length === 1) {
                return { ...action, mode: allowedProvisionModes[0] === "plain" ? "keyless" as const : "keyed" as const };
            }
            return action;
        }),
        allowedProvisionModes,
        recommendedProvisionMode,
    };
}

/**
 * The single effective authentication-method decision for this Home.
 *
 * Publication (`/v1/features`), request admission, startup lockout safety and
 * Home administration all read this one result. Consumers must not recompute
 * availability formulas from environment variables or provider registries.
 */
export function resolveEffectiveAuthMethodDecisions(
    inputs: EffectiveAuthMethodInputs,
): readonly EffectiveAuthMethodDecision[] {
    const { env, emailDeliveryReady } = inputs;
    const policy = resolveAuthPolicyFromEnv(env);
    const allowedProvisionModes = resolveAllowedAccountProvisionModes(env);
    const recommendedProvisionMode = resolveRecommendedAccountProvisionMode(env);

    const coreDecisions: EffectiveAuthMethodDecision[] = resolveAuthMethodRegistry(env).map((module) => {
        const resolved = module.resolveAuthMethod({
            env,
            policy,
            ...(inputs.admission ? { admission: inputs.admission } : {}),
        });
        return narrowAuthMethodDecisionForHomePolicy({
            id: normalizeId(resolved.id),
            actions: narrowForMailReadiness(
                resolved.actions as readonly EffectiveAuthMethodAction[],
                module.mailDependentActions,
                emailDeliveryReady,
            ),
            allowedProvisionModes,
            recommendedProvisionMode,
            ...(resolved.ui ? { ui: resolved.ui } : {}),
        }, inputs.homeAuthenticationPolicy, inputs.admission);
    });

    // External provider contributions share the same decision surface so that a
    // provider and a built-in method can never disagree about availability.
    const providerRegistry = resolveDeploymentAuthProviderFeatures(env).providers;
    const providerActions = createProviderAuthMethodActionTable(env);
    const signupProviders = policy.signupProviders.map(normalizeId);

    const providerDecisions: EffectiveAuthMethodDecision[] = providerRegistry
        .map((provider) => {
            const id = normalizeId(provider.id);
            const details = provider.resolveFeatures({ env, policy });
            return narrowAuthMethodDecisionForHomePolicy({
                id,
                actions: providerActions({
                    id,
                    enabled: Boolean(details.enabled),
                    configured: details.configured === true,
                    // Deployment providers provision only from the operator's signup allowlist.
                    keyedProvision: { enabled: signupProviders.includes(id) },
                }),
                allowedProvisionModes,
                recommendedProvisionMode,
                ...(details.ui?.displayName
                    ? { ui: { displayName: details.ui.displayName, iconHint: details.ui.iconHint ?? null } }
                    : {}),
            } satisfies EffectiveAuthMethodDecision, inputs.homeAuthenticationPolicy, inputs.admission);
        })
        .sort((a, b) => a.id.localeCompare(b.id));

    const decisions = [...coreDecisions, ...providerDecisions];
    const keyedKeyChallengeLoginEnabled = decisions.some((decision) =>
        decision.id === "key_challenge"
        && decision.actions.some((action) => action.id === "login"
            && action.enabled
            && (action.mode === "keyed" || action.mode === "either")));

    // Native E2EE password login unlocks the local envelope and then completes
    // the existing Key Challenge finalizer. Keep that dependency in this one
    // decision owner: route publication must not claim a keyed password login
    // when Home policy disabled its required finalizer. Plain password login is
    // independent and remains available when an `either` action loses only its
    // keyed branch.
    return Object.freeze(decisions.map((decision) => decision.id !== "email_password"
        ? decision
        : {
            ...decision,
            actions: decision.actions.map((action) => {
                if (action.id !== "login" || !action.enabled || keyedKeyChallengeLoginEnabled) return action;
                if (action.mode === "either") return { ...action, mode: "keyless" as const };
                if (action.mode === "keyed") {
                    return { ...action, enabled: false, reason: "method_not_enabled" as const };
                }
                return action;
            }),
        }));
}

export function findEffectiveAuthMethodDecision(
    inputs: EffectiveAuthMethodInputs,
    methodId: string,
): EffectiveAuthMethodDecision | null {
    const wanted = normalizeId(methodId);
    if (!wanted) return null;
    return resolveEffectiveAuthMethodDecisions(inputs).find((decision) => decision.id === wanted) ?? null;
}

/**
 * Route admission. An unknown method, an unknown action, or a disabled action
 * all fail closed.
 */
export function isEffectiveAuthMethodActionEnabled(
    inputs: EffectiveAuthMethodInputs,
    methodId: string,
    actionId: AuthMethodActionId,
): boolean {
    const decision = findEffectiveAuthMethodDecision(inputs, methodId);
    if (!decision) return false;
    return decision.actions.some((action) => action.id === actionId && action.enabled === true);
}

/**
 * Translation-only compatibility adapter for the retained `/v1/features` method
 * lists. It removes exactly the old-client-unsafe IDs and decides nothing else.
 */
export function toOldClientSafeAuthMethods(
    decisions: readonly EffectiveAuthMethodDecision[],
): AuthMethod[] {
    return decisions
        .filter((decision) => !OLD_CLIENT_UNSAFE_AUTH_METHOD_IDS.includes(decision.id))
        .map((decision) => ({
            id: decision.id,
            actions: decision.actions.map(({ id, enabled, mode }) => ({ id, enabled, mode })),
            ...(decision.ui ? { ui: decision.ui } : {}),
        }));
}

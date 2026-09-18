import type { Fastify } from "@/app/api/types";
import type { AuthPolicy } from "@/app/auth/authPolicy";
import type { FeaturesResponse } from "@/app/features/types";
import type { AuthEmailDelivery } from "@/app/auth/email/authEmailDelivery";
import type { ResolveAuthEmailApplicationLinkTarget } from "@/app/auth/email/nativeAuthEmailOperations";

export type AuthMethod = NonNullable<FeaturesResponse["capabilities"]["auth"]["methods"]>[number];

export type AuthMethodActionId = "login" | "provision" | "connect";
export type AuthMethodActionMode = "keyed" | "keyless" | "either";

/**
 * Account protection modes a Home may admit for a new Account. Resolved from the
 * existing encryption/storage policy owner; this is not a password-specific policy.
 */
export type AccountProvisionMode = "plain" | "e2ee";

/**
 * Why an otherwise supported action is not currently offered. Consumers render a
 * concise explanation; they never re-derive availability from these reasons.
 */
export type AuthMethodUnavailableReason =
    | "method_not_enabled"
    | "provisioning_not_enabled"
    | "account_mode_unavailable"
    | "email_delivery_unavailable";

export type EffectiveAuthMethodAction = Readonly<{
    id: AuthMethodActionId;
    enabled: boolean;
    mode: AuthMethodActionMode;
    reason?: AuthMethodUnavailableReason;
}>;

export type AuthMethodRouteContext = Readonly<{
    /** Readiness of the API-composed transactional-mail adapter. */
    isEmailDeliveryReady: () => boolean;
    /** The same API-composed adapter whose readiness feeds method policy. */
    authEmailDelivery: AuthEmailDelivery;
    /** Homes-owned portable application-link target consumed by bearer mail. */
    resolveApplicationLinkTarget: ResolveAuthEmailApplicationLinkTarget;
}>;

export type AuthMethodModule = Readonly<{
    id: string;
    /** Persisted AccountIdentity provider namespace owned by this native method, when it has one. */
    accountIdentityProviderId?: string;
    resolveAuthMethod: (params: {
        env: NodeJS.ProcessEnv;
        policy: AuthPolicy;
        /** Server-validated admission may enable provisioning without opening public signup. */
        admission?: Readonly<{
            kind: "team_invitation" | "team_provisioned_identity" | "team_jit_identity";
        }>;
    }) => AuthMethod;
    /**
     * Actions this method cannot complete without the transactional-mail boundary.
     * The effective-decision owner narrows them centrally from mail readiness, so
     * a method never advertises an action the request boundary would reject.
     */
    mailDependentActions?: readonly AuthMethodActionId[];
    /**
     * Register any routes required by this auth method. Modules must enforce their own gating/config.
     */
    registerRoutes: (app: Fastify, context?: AuthMethodRouteContext) => void;
}>;

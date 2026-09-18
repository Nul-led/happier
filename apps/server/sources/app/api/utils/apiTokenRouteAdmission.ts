import type { EphemeralSessionRunnerHttpOperation } from "../types";
import type { VerifiedEphemeralSessionRunnerPrincipal } from "@happier-dev/protocol/ephemeralRunner/principal";
import type {
    AuthTokenAuthenticationEvidenceV1,
    AuthTokenAuthority,
    AuthTokenKind,
} from "@happier-dev/protocol";

export const PRESENT_USER_REQUIRED_ERROR = "present_user_required" as const;
export const SESSION_RUNTIME_PUBLIC_AUTH_FORBIDDEN_ERROR = "session_runtime_public_auth_forbidden" as const;

type OptionalPublicAuthCandidate = Readonly<{
    userId: string;
    authTokenKind: AuthTokenKind;
    authority: AuthTokenAuthority;
    authenticationEvidence?: readonly AuthTokenAuthenticationEvidenceV1[];
}>;

type RejectedRestrictedPublicAuthCandidate = Readonly<{
    status: "rejected_restricted";
    authTokenKind: "ephemeral_session_runner";
}>;

export type OptionalPublicAuthDisposition =
    | Readonly<{ status: "anonymous" }>
    | Readonly<{
        status: "authenticated";
        principal: Omit<OptionalPublicAuthCandidate, "authority"> & Readonly<{
            authority: Exclude<AuthTokenAuthority, "session_runtime">;
        }>;
    }>
    | Readonly<{ status: "session_runtime_forbidden" }>;

/**
 * One disposition for credentials presented to optional-auth public surfaces.
 *
 * PAT and Directory credentials retain their established anonymous-compatible
 * behavior, while an ordinary Account/terminal credential may enrich the public
 * request. A verified restricted Session runtime is different: silently dropping
 * it would let that credential continue through a public token/cookie path with
 * authority it was never issued to exercise.
 */
export function resolveOptionalPublicAuthDisposition(
    verified: OptionalPublicAuthCandidate | RejectedRestrictedPublicAuthCandidate | null,
): OptionalPublicAuthDisposition {
    if (!verified) return { status: "anonymous" };
    if ("status" in verified) return { status: "session_runtime_forbidden" };
    if (verified.authTokenKind === "ephemeral_session_runner") {
        return { status: "session_runtime_forbidden" };
    }
    if (
        (verified.authTokenKind === "account" || verified.authTokenKind === "terminal")
        && verified.authority !== "session_runtime"
    ) {
        return {
            status: "authenticated",
            principal: { ...verified, authority: verified.authority },
        };
    }
    return { status: "anonymous" };
}

type AuthenticatedRouteRequest = Readonly<{
    authTokenKind?: unknown;
    userId?: unknown;
    sessionRuntimePrincipal?: VerifiedEphemeralSessionRunnerPrincipal;
    params?: unknown;
    body?: unknown;
    externalActionExecutionAuthorized?: unknown;
    externalActionEffectActionId?: unknown;
    routeOptions?: Readonly<{
        config?: Readonly<{
            allowApiToken?: unknown;
            allowAccountDirectoryToken?: unknown;
            ephemeralSessionRunnerOperation?: EphemeralSessionRunnerHttpOperation;
        }>;
    }>;
}>;

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Readonly<Record<string, unknown>>
        : null;
}

function isEphemeralSessionRunnerOperationAllowed(request: AuthenticatedRouteRequest): boolean {
    const principal = request.sessionRuntimePrincipal;
    if (!principal || request.userId !== principal.accountId) return false;
    const operation = request.routeOptions?.config?.ephemeralSessionRunnerOperation;
    const params = readRecord(request.params);
    const body = readRecord(request.body);
    switch (operation) {
        case "runtime_features":
            return true;
        case "session_detail":
        case "session_runtime":
            return params?.sessionId === principal.sessionId;
        case "session_shared_editor":
            return params?.sessionId === principal.sessionId && body?.mode === "shared_editor";
        case "session_follow_destination_runtime":
            return params?.destinationSessionId === principal.sessionId;
        case "session_machine_runtime":
            return body?.sessionId === principal.sessionId && body?.machineId === principal.machineId;
        case "session_usage_event":
            return body?.sessionId === principal.sessionId
                && (body?.machineId === undefined
                    || body.machineId === null
                    || body.machineId === principal.machineId);
        case "provider_broker_open": {
            const consumer = readRecord(body?.consumer);
            return body?.initiatorMachineId === principal.machineId
                && consumer?.kind === "session"
                && consumer?.sessionId === principal.sessionId;
        }
        default:
            return false;
    }
}

/** Restricted kinds never gain ordinary Home transport capabilities. */
export function isRestrictedAuthTokenKind(
    kind: unknown,
): boolean {
    switch (kind) {
        case "account":
        case "terminal":
            return false;
        case "api_token":
        case "account_directory":
        case "ephemeral_session_runner":
        default:
            return true;
    }
}

/**
 * Restricted credentials are opt-in at the HTTP route boundary, and
 * Directory-only routes reject ordinary Home credentials. A verified external
 * Action execution has already reconstructed its exact current PAT principal;
 * the explicit domain handler therefore applies that PAT's normal authority
 * without a second route-local Action-id registry.
 */
export function isRestrictedAuthTokenDeniedForRoute(
    request: AuthenticatedRouteRequest,
): boolean {
    switch (request.authTokenKind) {
        case "account":
            return request.routeOptions?.config?.allowAccountDirectoryToken === true;
        case "terminal":
            return request.routeOptions?.config?.allowAccountDirectoryToken === true;
        case "api_token":
            if (request.routeOptions?.config?.allowApiToken === true) return false;
            return request.externalActionExecutionAuthorized !== true;
        case "account_directory":
            return request.routeOptions?.config?.allowAccountDirectoryToken !== true;
        case "ephemeral_session_runner":
            return !isEphemeralSessionRunnerOperationAllowed(request);
        default:
            return true;
    }
}

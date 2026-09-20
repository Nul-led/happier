import type {
    EphemeralSessionRunnerRouteBinding,
    EphemeralSessionRunnerRouteMachineField,
    EphemeralSessionRunnerRouteSessionField,
} from "../types";
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
            ephemeralSessionRunnerBinding?: EphemeralSessionRunnerRouteBinding;
        }>;
    }>;
}>;

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Readonly<Record<string, unknown>>
        : null;
}

function readEphemeralSessionRunnerRouteField(
    request: AuthenticatedRouteRequest,
    field: EphemeralSessionRunnerRouteSessionField | EphemeralSessionRunnerRouteMachineField,
): unknown {
    const params = readRecord(request.params);
    const body = readRecord(request.body);
    switch (field) {
        case "params.sessionId":
            return params?.sessionId;
        case "params.destinationSessionId":
            return params?.destinationSessionId;
        case "body.sessionId":
            return body?.sessionId;
        case "body.consumer.sessionId": {
            const consumer = readRecord(body?.consumer);
            return consumer?.kind === "session" ? consumer.sessionId : undefined;
        }
        case "body.machineId":
            return body?.machineId;
        case "body.initiatorMachineId":
            return body?.initiatorMachineId;
    }
}

/**
 * A Runner credential is admitted on a route that declares how the request
 * names its Session and Machine, and only when those exact values are the ones
 * the credential was issued for. A route that declares no binding is not a
 * Runner surface and fails closed.
 */
function isEphemeralSessionRunnerRequestBound(request: AuthenticatedRouteRequest): boolean {
    const principal = request.sessionRuntimePrincipal;
    if (!principal || request.userId !== principal.accountId) return false;
    const binding = request.routeOptions?.config?.ephemeralSessionRunnerBinding;
    if (!binding) return false;
    if (binding.scope === "account") return true;
    if (readEphemeralSessionRunnerRouteField(request, binding.session) !== principal.sessionId) return false;
    if (binding.machine === undefined) return true;
    const machineId = readEphemeralSessionRunnerRouteField(request, binding.machine);
    if (binding.machineOptional === true && (machineId === undefined || machineId === null)) return true;
    return machineId === principal.machineId;
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
            return !isEphemeralSessionRunnerRequestBound(request);
        default:
            return true;
    }
}

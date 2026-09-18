import type { FastifyReply, FastifyRequest } from "fastify";

import type { Fastify } from "../types";
import { log } from "@/utils/logging/log";
import { captureAccountStoredContentCompatibilityForHttpRequest } from "@/app/clientCompatibility/accountStoredContentCompatibility";
import {
    ACCOUNT_DIRECTORY_ERROR_CODES_V1,
    type AuthTokenAuthenticationEvidenceV1,
} from "@happier-dev/protocol";
import { redactHttpRequestUrlForLog } from "@/utils/logging/redactHttpRequestUrlForLog";
import {
    isRestrictedAuthTokenDeniedForRoute,
    PRESENT_USER_REQUIRED_ERROR,
} from "./apiTokenRouteAdmission";
import { readBearerCredential, verifyRequestPrincipal } from "./verifyRequestPrincipal";
import {
    EXTERNAL_ACTION_EFFECT_ACTION_HEADER,
    EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_HEADER,
    EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_VERIFY_HTTP_PATH_TEMPLATE_V1,
    EXTERNAL_ACTION_MACHINE_SIGNATURE_HEADER,
    EXTERNAL_ACTION_RESOLVED_TARGET_HEADER,
} from "@happier-dev/protocol/actions";
import {
    verifyExternalActionDomainExecutionRequest,
    verifyExternalActionExecutionAuthorizationCurrentness,
} from "@/app/auth/externalActionExecutionAuthorization";

function readScalarHeader(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function stampApiTokenPrincipal(request: FastifyRequest, principal: NonNullable<FastifyRequest["apiTokenPrincipal"]>): void {
    request.userId = principal.accountId;
    request.authTokenKind = "api_token";
    request.authAuthority = principal.authority;
    request.authTokenLegacy = false;
    request.authTokenAuthenticationEvidence = principal.authenticationEvidence;
    request.apiTokenPrincipal = principal;
}

function stampSessionRuntimePrincipal(
    request: FastifyRequest,
    principal: NonNullable<FastifyRequest["sessionRuntimePrincipal"]>,
    authenticationEvidence: readonly AuthTokenAuthenticationEvidenceV1[] | undefined,
): void {
    request.userId = principal.accountId;
    request.authTokenKind = "ephemeral_session_runner";
    // The restricted principal remains Session/Machine-bound by its verified typed projection.
    // For shared authorization owners it is nevertheless an autonomous runtime operation,
    // never an operation by the latest human message author or approving caller.
    request.authAuthority = "account_automation";
    request.authTokenLegacy = false;
    request.authTokenAuthenticationEvidence = authenticationEvidence;
    request.sessionRuntimePrincipal = principal;
}
function shouldLogAuthDecoratorDiagnostics(): boolean {
    return process.env.HAPPIER_AUTH_DECORATOR_DIAGNOSTIC_LOGS === "1"
        || process.env.HAPPY_AUTH_DECORATOR_DIAGNOSTIC_LOGS === "1";
}

function sendInvalidConnectionCredentialFailure(request: FastifyRequest, reply: FastifyReply) {
    const configuredError = request.routeOptions?.config?.connectionAuthFailureError;
    const error = configuredError === "authentication_failed" || configuredError === "invalid_token"
        ? configuredError
        : "invalid_token";
    return reply.code(401).send({ error });
}

export function enableAuthentication(app: Fastify) {
    app.decorate('authenticate', async function (request: any, reply: any) {
        try {
            const authHeader = request.headers.authorization;
            const executionAuthorization = readScalarHeader(
                request.headers[EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_HEADER],
            );
            const machineSignature = readScalarHeader(
                request.headers[EXTERNAL_ACTION_MACHINE_SIGNATURE_HEADER],
            );
            const effectActionId = readScalarHeader(request.headers[EXTERNAL_ACTION_EFFECT_ACTION_HEADER]);
            const encodedTarget = readScalarHeader(request.headers[EXTERNAL_ACTION_RESOLVED_TARGET_HEADER]);
            const hasExternalActionHeader = executionAuthorization !== null
                || machineSignature !== null
                || effectActionId !== null
                || encodedTarget !== null;
            // Never log bearer tokens or header contents.
            const logDiagnostics = shouldLogAuthDecoratorDiagnostics();
            if (logDiagnostics) {
                log(
                    { module: 'auth-decorator' },
                    `Auth check - path: ${redactHttpRequestUrlForLog(request.url)}, has header: ${!!authHeader}`,
                );
            }
            if (hasExternalActionHeader) {
                if (
                    authHeader !== undefined
                    || !executionAuthorization
                    || !machineSignature
                    || !effectActionId
                    || !encodedTarget
                ) {
                    return sendInvalidConnectionCredentialFailure(request, reply);
                }
                const proof = {
                    authorizationToken: executionAuthorization,
                    machineSignature,
                    effectActionId,
                    encodedTarget,
                    method: request.method,
                    path: request.url,
                    body: request.body,
                };
                const routeActionId = typeof request.params?.actionId === "string"
                    ? request.params.actionId
                    : null;
                const authorizationCurrentnessActionId = routeActionId !== null
                    && request.routeOptions?.url
                        === EXTERNAL_ACTION_EXECUTION_AUTHORIZATION_VERIFY_HTTP_PATH_TEMPLATE_V1
                    ? routeActionId
                    : null;
                const verified = authorizationCurrentnessActionId !== null
                    ? await verifyExternalActionExecutionAuthorizationCurrentness({
                        ...proof,
                        outerActionId: authorizationCurrentnessActionId,
                    })
                    : await verifyExternalActionDomainExecutionRequest(proof);
                if (!verified) return sendInvalidConnectionCredentialFailure(request, reply);
                stampApiTokenPrincipal(request, verified.principal);
                request.externalActionExecutionAuthorized = true;
                request.externalActionEffectActionId = verified.effectActionId;
                request.externalActionRootActionId = verified.binding.actionId;
                request.externalActionExecutionTarget = verified.target;
                if (isRestrictedAuthTokenDeniedForRoute(request)) {
                    return reply.code(403).send({ error: PRESENT_USER_REQUIRED_ERROR });
                }
                captureAccountStoredContentCompatibilityForHttpRequest(request);
                return;
            }
            if (readBearerCredential(authHeader) === null) {
                log({ module: 'auth-decorator' }, `Auth failed - missing or invalid header`);
                if (request.routeOptions?.config?.connectionAuthFailureError === "invalid_token") {
                    return sendInvalidConnectionCredentialFailure(request, reply);
                }
                return reply.code(401).send({ error: 'Missing authorization header' });
            }

            // A pre-marker credential is an ordinary-Home compatibility input,
            // never a Directory or Team credential. Directory routes and
            // route families that explicitly reject legacy Home authority use
            // only the strict current verifier; ordinary Home routes retain
            // the explicitly named compatibility reader.
            const verification = await verifyRequestPrincipal({
                authorizationHeader: authHeader,
                allowLegacyHomeToken: request.routeOptions?.config?.allowAccountDirectoryToken !== true
                    && request.routeOptions?.config?.allowLegacyHomeToken !== false,
                env: process.env,
            });
            if (
                verification.status === "absent"
                || verification.status === "invalid"
                || verification.status === "rejected_restricted"
            ) {
                log({ module: 'auth-decorator' }, `Auth failed - invalid token`);
                return sendInvalidConnectionCredentialFailure(request, reply);
            }
            if (verification.status === "ineligible") {
                const eligibility = verification.eligibility;
                if (eligibility.statusCode === 401) {
                    return sendInvalidConnectionCredentialFailure(request, reply);
                }
                const fallback = eligibility.statusCode === 503 ? "upstream_error" : "not-eligible";
                if (eligibility.statusCode === 403 && eligibility.error === "provider-required") {
                    return reply.code(403).send({ error: "provider-required", provider: eligibility.provider });
                }
                if (eligibility.statusCode === 403 && eligibility.error === "account-disabled") {
                    return sendInvalidConnectionCredentialFailure(request, reply);
                }
                return reply.code(eligibility.statusCode).send({ error: eligibility.error ?? fallback });
            }

            const principal = verification.principal;
            const tokenKind = principal.kind;
            if (logDiagnostics) {
                log({ module: 'auth-decorator' }, `Auth success - user: ${principal.accountId}`);
            }
            const apiTokenPrincipal = principal.apiTokenPrincipal;
            if (tokenKind === "api_token" && !apiTokenPrincipal) {
                return sendInvalidConnectionCredentialFailure(request, reply);
            }
            if (apiTokenPrincipal) {
                stampApiTokenPrincipal(request, apiTokenPrincipal);
            } else if (principal.sessionRuntimePrincipal) {
                stampSessionRuntimePrincipal(
                    request,
                    principal.sessionRuntimePrincipal,
                    principal.authenticationEvidence,
                );
            } else {
                request.userId = principal.accountId;
                request.authTokenKind = tokenKind;
                request.authAuthority = principal.authority;
                request.authTokenLegacy = principal.legacy;
                request.authTokenAuthenticationEvidence = principal.authenticationEvidence;
            }
            if (isRestrictedAuthTokenDeniedForRoute(request)) {
                const error = request.routeOptions?.config?.allowAccountDirectoryToken === true
                    ? ACCOUNT_DIRECTORY_ERROR_CODES_V1.invalidRequest
                    : request.routeOptions?.config?.restrictedAuthFailureError
                        ?? PRESENT_USER_REQUIRED_ERROR;
                return reply.code(403).send({ error });
            }
            captureAccountStoredContentCompatibilityForHttpRequest(request);
        } catch {
            return sendInvalidConnectionCredentialFailure(request, reply);
        }
    });
}

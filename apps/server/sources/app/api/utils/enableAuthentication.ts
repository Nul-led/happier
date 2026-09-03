import type { FastifyReply, FastifyRequest } from "fastify";

import { Fastify } from "../types";
import { log } from "@/utils/logging/log";
import { auth, type VerifiedApiTokenPrincipal } from "@/app/auth/auth";
import { enforceLoginEligibility } from "@/app/auth/enforceLoginEligibility";
import { captureAccountStoredContentCompatibilityForHttpRequest } from "@/app/clientCompatibility/accountStoredContentCompatibility";
import {
    ACCOUNT_DIRECTORY_ERROR_CODES_V1,
    AuthTokenProvenanceSchema,
    type AuthTokenKind,
    type AuthTokenProvenance,
} from "@happier-dev/protocol";
import { redactHttpRequestUrlForLog } from "@/utils/logging/redactHttpRequestUrlForLog";
import {
    isRestrictedAuthTokenDeniedForRoute,
    PRESENT_USER_REQUIRED_ERROR,
} from "./apiTokenRouteAdmission";

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

type VerifiedTokenProvenance = Readonly<{
    userId: string;
    extras?: unknown;
    authTokenKind?: unknown;
    authority?: unknown;
    legacy: boolean;
    apiTokenPrincipal?: VerifiedApiTokenPrincipal;
}>;

function resolveVerifiedAuthProvenance(
    verified: VerifiedTokenProvenance,
): AuthTokenProvenance | null {
    const parsed = AuthTokenProvenanceSchema.safeParse({
        v: 1,
        kind: verified.authTokenKind,
        authority: verified.authority,
    });
    return parsed.success ? parsed.data : null;
}

function resolveVerifiedApiTokenPrincipal(
    verified: VerifiedTokenProvenance,
    tokenKind: AuthTokenKind,
): VerifiedApiTokenPrincipal | null {
    if (tokenKind !== "api_token") return null;
    const principal = verified.apiTokenPrincipal;
    if (
        !principal
        || principal.authority !== "account_automation"
        || principal.accountId !== verified.userId
        || !principal.accountId.trim()
        || !principal.principalId.trim()
        || !principal.credentialId.trim()
    ) {
        return null;
    }
    return principal;
}

export function enableAuthentication(app: Fastify) {
    app.decorate('authenticate', async function (request: any, reply: any) {
        try {
            const authHeader = request.headers.authorization;
            // Never log bearer tokens or header contents.
            const logDiagnostics = shouldLogAuthDecoratorDiagnostics();
            if (logDiagnostics) {
                log(
                    { module: 'auth-decorator' },
                    `Auth check - path: ${redactHttpRequestUrlForLog(request.url)}, has header: ${!!authHeader}`,
                );
            }
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                log({ module: 'auth-decorator' }, `Auth failed - missing or invalid header`);
                if (request.routeOptions?.config?.connectionAuthFailureError === "invalid_token") {
                    return sendInvalidConnectionCredentialFailure(request, reply);
                }
                return reply.code(401).send({ error: 'Missing authorization header' });
            }

            const token = authHeader.substring(7);
            // A pre-marker credential is an ordinary-Home compatibility input,
            // never a Directory credential. Directory routes therefore use
            // only the strict current verifier; every other HTTP route may
            // fall back to the explicitly named legacy reader.
            const verified = await auth.verifyToken(token)
                ?? (request.routeOptions?.config?.allowAccountDirectoryToken === true
                    ? null
                    : await auth.verifyLegacyHomeToken(token));
            if (!verified) {
                log({ module: 'auth-decorator' }, `Auth failed - invalid token`);
                return sendInvalidConnectionCredentialFailure(request, reply);
            }

            // Auth provenance is a closed, server-verified contract. Do this
            // before login eligibility or any route handler can observe the
            // subject, so missing/unknown/future markers cannot default to an
            // ordinary Account credential.
            const provenance = resolveVerifiedAuthProvenance(verified);
            if (!provenance) {
                return sendInvalidConnectionCredentialFailure(request, reply);
            }
            const tokenKind = provenance.kind;
            const authority = provenance.authority;

            const eligibility = await enforceLoginEligibility({ accountId: verified.userId, env: process.env });
            if (!eligibility.ok) {
                if (eligibility.statusCode === 401) {
                    return sendInvalidConnectionCredentialFailure(request, reply);
                }
                const fallback = eligibility.statusCode === 503 ? "upstream_error" : "not-eligible";
                if (eligibility.statusCode === 403 && eligibility.error === "provider-required") {
                    return reply.code(403).send({ error: "provider-required", provider: eligibility.provider });
                }
                if (eligibility.statusCode === 403 && eligibility.error === "account-disabled") {
                    return reply.code(403).send({ error: "account-disabled" });
                }
                return reply.code(eligibility.statusCode).send({ error: eligibility.error ?? fallback });
            }

            if (logDiagnostics) {
                log({ module: 'auth-decorator' }, `Auth success - user: ${verified.userId}`);
            }
            request.userId = verified.userId;
            request.authTokenKind = tokenKind;
            request.authAuthority = authority;
            request.authTokenLegacy = verified.legacy;
            const apiTokenPrincipal = resolveVerifiedApiTokenPrincipal(verified, tokenKind);
            if (tokenKind === "api_token" && !apiTokenPrincipal) {
                return sendInvalidConnectionCredentialFailure(request, reply);
            }
            if (isRestrictedAuthTokenDeniedForRoute(request)) {
                const error = request.routeOptions?.config?.allowAccountDirectoryToken === true
                    ? ACCOUNT_DIRECTORY_ERROR_CODES_V1.invalidRequest
                    : PRESENT_USER_REQUIRED_ERROR;
                return reply.code(403).send({ error });
            }
            if (apiTokenPrincipal) {
                request.apiTokenPrincipal = apiTokenPrincipal;
            }
            captureAccountStoredContentCompatibilityForHttpRequest(request);
        } catch {
            return sendInvalidConnectionCredentialFailure(request, reply);
        }
    });
}

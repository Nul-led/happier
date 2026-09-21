import { randomBytes } from "node:crypto";
import { auth } from "@/app/auth/auth";
import { isOAuthStateUnavailableError } from "@/app/auth/oauthStateErrors";
import { generatePkceVerifier, pkceChallengeS256 } from "@/app/oauth/pkce";
import type { OAuthFlowProvider } from "@/app/oauth/providers/types";
import type { ProviderReference } from "@/app/auth/providers/providerReference";
import type { GitHubAppManagementAuthenticationV1 } from "@/app/integrations/github/githubManagedApp";
import { db } from "@/storage/db";
import { randomKeyNaked } from "@/utils/keys/randomKeyNaked";
import { resolveOauthStateAttemptTtlMsFromEnv } from "./oauthExternalConfig";
import type { TeamOAuthAdmissionSource } from "@/app/teams/memberships/teamOAuthAdmissionSource";

type TeamOAuthAdmissionSeed =
    | Extract<TeamOAuthAdmissionSource, { kind: "team_invitation" }>
    | Omit<Extract<TeamOAuthAdmissionSource, { kind: "team_jit_identity" }>, "authAttemptId">
    | null;

type ExternalAuthorizeFlowParams =
    | Readonly<{
          flow: "auth";
          providerId: string;
          provider: OAuthFlowProvider;
          /** Catalog reference of the exact runtime that produced `provider`, bound into the attempt. */
          reference: ProviderReference;
          env: NodeJS.ProcessEnv;
          publicKeyHex: string | null;
          proofHash: string | null;
          purpose?: "account_encryption_first_key" | "account_password_enrollment" | "account_directory" | "team_admission";
          userId?: string;
          requestDigest?: string;
          endpointUrl?: string;
          endpointServerIdentityId?: string;
          canonicalServerUrl?: string;
          connection?: Readonly<{ id: string; revision: number }>;
          admission?: TeamOAuthAdmissionSeed;
          attemptExpiresAt?: Date;
          webAppOAuthReturnUrl?: string | null;
      }>
    | Readonly<{
          flow: "connect";
          providerId: string;
          provider: OAuthFlowProvider;
          /** Catalog reference of the exact runtime that produced `provider`, bound into the attempt. */
          reference: ProviderReference;
          env: NodeJS.ProcessEnv;
          userId: string;
          purpose?: "identity_connection_test";
          connection?: Readonly<{ id: string; revision: number }>;
          connectFinalization?: "credential_adoption_v1";
          webAppOAuthReturnUrl?: string | null;
      }>
    | Readonly<{
          flow: "connect";
          purpose: "github_app_installation_verification";
          providerId: string;
          provider: OAuthFlowProvider;
          env: NodeJS.ProcessEnv;
          userId: string;
          githubAppInstallationVerification: Readonly<{
              owner: Readonly<{ kind: "home" }> | Readonly<{ kind: "team"; teamId: string }>;
              registrationId: string;
              registrationRevision: number;
              registrationSecurityRevision: number;
              installationRevision: number;
              networkPolicyFingerprint: string;
              githubInstallationId: string;
              githubOrganizationId: string;
              authentication?: GitHubAppManagementAuthenticationV1;
          }>;
          webAppOAuthReturnUrl?: string | null;
      }>;

export type ExternalAuthorizeAttempt = Readonly<{ url: string; attemptId: string }>;

export async function createExternalAuthorizeAttempt(
    params: ExternalAuthorizeFlowParams,
): Promise<ExternalAuthorizeAttempt | null> {
    const ttlMs = resolveOauthStateAttemptTtlMsFromEnv(params.env);
    const attemptExpiresAt = params.flow === "auth" && params.attemptExpiresAt
        ? new Date(params.attemptExpiresAt.getTime())
        : new Date(Date.now() + ttlMs);
    if (!Number.isFinite(attemptExpiresAt.getTime())) {
        throw new Error("Invalid OAuth state-attempt expiry");
    }
    const pkceCodeVerifier = generatePkceVerifier(64);
    const codeChallenge = pkceChallengeS256(pkceCodeVerifier);
    const nonce = randomBytes(32).toString("base64url");

    let sid = "";
    for (let i = 0; i < 3; i++) {
        sid = randomKeyNaked(24);
        const admission = params.flow === "auth" && params.purpose === "team_admission"
            && params.admission?.kind === "team_jit_identity"
            ? { ...params.admission, authAttemptId: sid }
            : params.flow === "auth" && params.purpose === "team_admission"
                ? params.admission ?? null
                : null;
        try {
            await db.repeatKey.create({
                data: {
                    key: `oauth_state_${sid}`,
                    value: JSON.stringify({
                        provider: params.providerId,
                        ...(params.provider.callbackProviderId
                            ? { callbackProvider: params.provider.callbackProviderId }
                            : {}),
                        ...(params.flow === "connect" && params.purpose === "github_app_installation_verification"
                            ? {
                                purpose: params.purpose,
                                githubAppInstallationVerification: params.githubAppInstallationVerification,
                            }
                            : {
                                securityBinding: {
                                    provider: params.reference,
                                    connection: params.flow === "connect" && params.purpose === "identity_connection_test"
                                        ? params.connection ?? null
                                        : params.flow === "auth" && params.purpose === "team_admission"
                                            ? params.connection ?? null
                                            : null,
                                    // Structural admission is re-decided from Team mode and exact
                                    // current evidence during finalization; OAuth success never
                                    // mints a generic membership capability.
                                    admission,
                                    purpose: params.purpose ?? null,
                                },
                            }),
                        pkceCodeVerifier,
                        nonce,
                        ...(params.flow === "auth" && params.purpose === "account_directory"
                            ? {
                                purpose: params.purpose,
                                endpointUrl: params.endpointUrl,
                                endpointServerIdentityId: params.endpointServerIdentityId,
                                canonicalServerUrl: params.canonicalServerUrl,
                            }
                            : {}),
                        ...(params.flow === "auth"
                            && (params.purpose === "account_encryption_first_key"
                                || params.purpose === "account_password_enrollment")
                            ? {
                                userId: params.userId,
                                proofHash: params.proofHash,
                                requestDigest: params.requestDigest,
                            }
                            : {}),
                        ...(params.flow === "connect" && params.purpose === "identity_connection_test"
                            ? { purpose: params.purpose }
                            : {}),
                        ...(params.flow === "connect"
                            && "connectFinalization" in params
                            && params.connectFinalization
                            ? { connectFinalization: params.connectFinalization }
                            : {}),
                        ...(params.webAppOAuthReturnUrl ? { webAppOAuthReturnUrl: params.webAppOAuthReturnUrl } : {}),
                    }),
                    expiresAt: attemptExpiresAt,
                },
            });
            break;
        } catch {
            sid = "";
        }
    }
    if (!sid) return null;
    const repeatKeyId = `oauth_state_${sid}`;

    let state: string;
    try {
        state = params.flow === "auth"
            ? await auth.createOauthStateToken({
                  flow: "auth",
                  provider: params.provider.callbackProviderId ?? params.providerId,
                  sid,
                  publicKey: params.publicKeyHex,
                  proofHash: params.proofHash,
                  ...(params.purpose ? {
                      purpose: params.purpose,
                      userId: params.userId,
                      requestDigest: params.requestDigest,
                      endpointUrl: params.endpointUrl,
                      endpointServerIdentityId:
                          params.endpointServerIdentityId,
                      canonicalServerUrl: params.canonicalServerUrl,
                  } : {}),
              })
            : await auth.createOauthStateToken({
                  flow: "connect",
                  provider: params.provider.callbackProviderId ?? params.providerId,
                  sid,
                  userId: params.userId,
                  ...(params.purpose === "github_app_installation_verification"
                      ? { purpose: params.purpose }
                      : {}),
              });
    } catch (error) {
        if (isOAuthStateUnavailableError(error)) {
            await db.repeatKey.delete({ where: { key: repeatKeyId } }).catch(() => undefined);
            return null;
        }
        throw error;
    }

    const scope = params.provider.resolveScope({ env: params.env, flow: params.flow });
    const url = await params.provider.resolveAuthorizeUrl({
        env: params.env,
        state,
        scope,
        codeChallenge,
        codeChallengeMethod: "S256",
        nonce,
    });
    return { url, attemptId: sid };
}

export async function createExternalAuthorizeUrl(params: ExternalAuthorizeFlowParams): Promise<string | null> {
    const attempt = await createExternalAuthorizeAttempt(params);
    return attempt?.url ?? null;
}

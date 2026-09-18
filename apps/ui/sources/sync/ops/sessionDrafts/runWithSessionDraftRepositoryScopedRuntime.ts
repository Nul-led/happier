import { getRandomBytes } from '@/platform/cryptoRandom';
import { isTokenOnlyAuthCredentials } from '@/auth/storage/tokenStorage';
import { createApiSessionDraftsTransport } from '@/sync/api/account/apiSessionDrafts';
import { fetchAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import { resolveAccountScopedCryptoMaterialFromCredentials } from '@/sync/domains/connectedServices/resolveAccountScopedCryptoMaterialFromCredentials';
import { resolveRuntimeFeatureDecisionOrThrow } from '@/sync/domains/features/featureDecisionInputs';
import {
    areServerAccountScopesEqual,
    type ServerAccountScope,
} from '@/sync/domains/scope/serverAccountScope';
import type { ServerCredentialAccountScopeBinding } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { createSessionDraftCipher } from '@/sync/encryption/sessionDraftEncryption';
import {
    runWithServerRequestAuthorityForServerAccountScope,
    type ServerAccountRequestOptions,
} from '@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope';

import type { SessionDraftRepositoryScopedRuntime } from './sessionDraftRepository';

type ActiveRequest = (
    path: string,
    init?: RequestInit,
    options?: ServerAccountRequestOptions,
) => Promise<Response>;

/**
 * Composes one exact inactive-Home draft invocation from the canonical request,
 * Account-mode and draft-cipher owners. The binding, not the focused Sync,
 * decides whether the invocation may still publish a result.
 */
export async function runWithSessionDraftRepositoryScopedRuntime<TResult>(params: Readonly<{
    binding: ServerCredentialAccountScopeBinding;
    activeRequest: ActiveRequest;
    operation: (input: Readonly<{
        scope: ServerAccountScope;
        runtime: SessionDraftRepositoryScopedRuntime;
        isCurrent: () => boolean;
    }>) => Promise<TResult>;
}>): Promise<TResult | null> {
    if (!params.binding.isCurrent()) return null;
    return await runWithServerRequestAuthorityForServerAccountScope({
        scope: params.binding.scope,
        activeRequest: params.activeRequest,
    }, async (authority) => {
        const isCurrent = () => params.binding.isCurrent()
            && areServerAccountScopesEqual(authority.scope, params.binding.scope);
        if (!isCurrent()) return null;
        const credentials = authority.context.credentials;
        if (!credentials) return null;
        const request: ActiveRequest = async (path, init, options) => {
            if (!isCurrent()) throw new Error('Session draft Account authority retired');
            const response = await authority.request(path, init, options);
            if (!isCurrent()) throw new Error('Session draft Account authority retired');
            return response;
        };
        const featureDecision = await resolveRuntimeFeatureDecisionOrThrow({
            featureId: 'sessions.drafts',
            serverId: authority.scope.serverId,
        });
        if (!isCurrent()) return null;
        if (featureDecision.state !== 'enabled') return null;
        const mode = await fetchAccountEncryptionMode(credentials, { request });
        if (!isCurrent()) return null;
        return await params.operation({
            scope: authority.scope,
            isCurrent,
            runtime: {
                transport: createApiSessionDraftsTransport({ request }),
                cipher: createSessionDraftCipher({
                    accountMode: mode.mode,
                    accountCryptoMaterial: mode.mode === 'e2ee' && !isTokenOnlyAuthCredentials(credentials)
                        ? resolveAccountScopedCryptoMaterialFromCredentials(credentials)
                        : null,
                    // This recovery projection admits only newSession drafts,
                    // whose content is Account-bound rather than Session-bound.
                    getSessionContext: () => null,
                    randomBytes: getRandomBytes,
                }),
            },
        });
    });
}

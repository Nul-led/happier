import {
    accountDirectoryAuthClient,
    type AccountDirectoryAuthMethodDiscovery,
} from '@/auth/accountDirectory/accountDirectoryAuthClient';
import { normalizeSecretKey } from '@/auth/recovery/secretKeyBackup';
import type { AccountServiceEntryIntent } from '@/auth/storage/tokenStorage';
import { decodeBase64 } from '@/encryption/base64';
import { Modal } from '@/modal';
import {
    createAccountDirectoryServiceKey,
    createAccountDirectorySession,
    type AccountDirectorySession,
    type AccountDirectorySessionSnapshot,
} from '@/sync/domains/accountDirectory/accountDirectorySession';
import {
    setAccountServiceEndpoint,
    type AccountServiceEndpointV1,
} from '@/sync/domains/server/serverProfiles';
import {
    enrollPreferredDirectoryHome,
    type PreferredDirectoryHomeEnrollmentResult,
} from '@/sync/ops/accountDirectory/enrollPreferredDirectoryHome';
import { refreshAccountHomeDirectory } from '@/sync/ops/accountDirectory/refreshAccountHomeDirectory';
import { t } from '@/text';

export type AccountServiceKeyAuthOutcome =
    | Readonly<{ kind: 'cancelled' }>
    | Readonly<{ kind: 'invalid_key' }>
    | Readonly<{ kind: 'unavailable' }>
    | Readonly<{ kind: 'failed' }>
    | Readonly<{
        kind: 'authenticated';
        /** Canonical service key of the exact authenticated Account Service selection. */
        serviceKey: string;
        discovery: AccountDirectoryAuthMethodDiscovery;
        session: AccountDirectorySession;
    }>;

/**
 * The one canonical Account Service key sign-in ceremony (Lane 02 A7 / G02-2), shared by the
 * unauthenticated Welcome entry and authenticated Settings.
 *
 * It runs entirely against the exact selected service through Lane 01's explicit endpoint
 * boundary: endpoint-targeted method discovery (which proves the service advertises key
 * login), the secure secret prompt, restricted `account_directory` credential storage, and
 * the observed stable identity bound through the existing Account Service endpoint owner.
 * The focused Home is never read, no Home runtime is constructed, and the ordinary Home
 * credential namespace is never written.
 */
export async function authenticateSelectedAccountServiceWithKey(input: Readonly<{
    endpoint: AccountServiceEndpointV1;
    /**
     * Synchronous hook invoked with the observed service key immediately before the selection
     * bind, so owners that track attempt/invalidation bookkeeping can update it first.
     */
    onServiceIdentityObserved?: (observed: Readonly<{
        serverIdentityId: string;
        serviceKey: string;
    }>) => void;
    shouldCancel?: () => boolean;
}>): Promise<AccountServiceKeyAuthOutcome> {
    let discovery: AccountDirectoryAuthMethodDiscovery;
    try {
        const result = await accountDirectoryAuthClient.discoverAuthenticationMethods({
            endpointUrl: input.endpoint.url,
            expectedServerIdentityId: input.endpoint.serverIdentityId,
            requestedMethod: { kind: 'key' },
        });
        if (input.shouldCancel?.()) return { kind: 'cancelled' };
        if (result.kind !== 'supported_account_service') {
            return { kind: 'unavailable' };
        }
        discovery = result;
    } catch {
        return { kind: 'unavailable' };
    }

    const rawSecret = await Modal.prompt(
        t('connect.secretKeyInputLabel'),
        t('connect.restoreWithSecretKeyDescription'),
        {
            inputType: 'secure-text',
            confirmText: t('common.login'),
            cancelText: t('common.cancel'),
        },
    );
    if (rawSecret === null || input.shouldCancel?.()) return { kind: 'cancelled' };

    let secret: Uint8Array;
    try {
        secret = decodeBase64(normalizeSecretKey(rawSecret), 'base64url');
        if (secret.length !== 32) throw new Error('Invalid secret key length');
    } catch {
        return { kind: 'invalid_key' };
    }

    try {
        const authenticatedEndpoint = { ...input.endpoint, serverIdentityId: discovery.serverIdentityId };
        const authenticatedServiceKey = createAccountDirectoryServiceKey({
            endpoint: input.endpoint.url,
            serverIdentityId: discovery.serverIdentityId,
        });
        input.onServiceIdentityObserved?.({
            serverIdentityId: discovery.serverIdentityId,
            serviceKey: authenticatedServiceKey,
        });
        setAccountServiceEndpoint(authenticatedEndpoint);
        await accountDirectoryAuthClient.loginWithKey({
            endpointUrl: input.endpoint.url,
            endpointServerIdentityId: discovery.serverIdentityId,
            canonicalServerUrl: discovery.canonicalServerUrl,
            secret,
        });
        if (input.shouldCancel?.()) return { kind: 'cancelled' };
        return {
            kind: 'authenticated',
            serviceKey: authenticatedServiceKey,
            discovery,
            session: createAccountDirectorySession({
                endpoint: input.endpoint.url,
                serverIdentityId: discovery.serverIdentityId,
            }, { capability: discovery.capability }),
        };
    } catch {
        return { kind: 'failed' };
    }
}

/**
 * Canonical post-authentication Directory refresh plus preferred-Home enrollment. The entry
 * intent is supplied by the caller: unauthenticated entry passes `enter_preferred_home`,
 * authenticated Settings passes `connect_service`. Neither refresh, credential storage, nor
 * adoption ever changes focus as a side effect; only the enrollment owner applies
 * `enter_preferred_home` through its explicit intent finalizer.
 */
export async function refreshAndEnrollAccountServiceDirectory(
    session: AccountDirectorySession,
    options: Readonly<{
        entryIntent: AccountServiceEntryIntent;
        shouldCancel?: () => boolean;
        shouldInvalidateContinuation?: () => boolean;
        enroll?: boolean;
    }>,
): Promise<Readonly<{
    snapshot: AccountDirectorySessionSnapshot;
    enrollment: PreferredDirectoryHomeEnrollmentResult | null;
}>> {
    const refreshed = await refreshAccountHomeDirectory(session, options);
    let enrollment: PreferredDirectoryHomeEnrollmentResult | null = null;
    if (
        refreshed.status === 'ready'
        && session.supportsHomeEnrollment
        && options.enroll !== false
        && options.shouldCancel?.() !== true
    ) {
        enrollment = await enrollPreferredDirectoryHome(session, options);
    }
    return { snapshot: refreshed, enrollment };
}

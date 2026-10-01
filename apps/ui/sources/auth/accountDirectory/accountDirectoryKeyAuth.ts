import { accountDirectoryAuthClient, type VerifiedAccountServiceAuthority, type AccountDirectoryAuthTransport } from './accountDirectoryAuthClient';
import { createAccountDirectoryServiceKey, createAccountDirectorySession, type AccountDirectorySession } from '@/sync/domains/accountDirectory/accountDirectorySession';
import { isAccountDirectoryRelinkConflict } from '@/sync/api/accountDirectory/accountDirectoryClient';
import { getRandomBytesAsync } from '@/platform/cryptoRandom';
import { digestAccountDirectoryCredentialToken } from '@/auth/storage/tokenStorage';

export type AccountServiceKeyAuthOutcome =
    | Readonly<{ kind: 'cancelled' | 'invalid_key' | 'unavailable' }>
    | Readonly<{ kind: 'relink_required'; error: unknown }>
    | Readonly<{ kind: 'failed'; error: unknown }>
    | Readonly<{
        kind: 'authenticated';
        serviceKey: string;
        service: VerifiedAccountServiceAuthority;
        session: AccountDirectorySession;
        credentialTokenDigest: string;
    }>;

export async function authenticateSelectedAccountServiceWithKey(input: Readonly<{
    service: VerifiedAccountServiceAuthority;
    secret: Uint8Array;
    signal?: AbortSignal;
    transport?: AccountDirectoryAuthTransport;
}>): Promise<AccountServiceKeyAuthOutcome> {
    if (input.signal?.aborted) return { kind: 'cancelled' };
    if (!(input.secret instanceof Uint8Array) || input.secret.length !== 32) return { kind: 'invalid_key' };
    const secret = input.secret.slice();
    const { service } = input;
    try {
        const credentials = await accountDirectoryAuthClient.loginWithKey({
            endpointUrl: service.endpointUrl,
            endpointServerIdentityId: service.serverIdentityId,
            canonicalServerUrl: service.canonicalServerUrl,
            secret,
            signal: input.signal,
            ...input.transport,
            verifiedServerFeaturesSnapshot: service.snapshot,
        });
        if (input.signal?.aborted) return { kind: 'cancelled' };
        const target = { endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId };
        const session = createAccountDirectorySession(target, { capability: service.capability, keyAuthSecret: secret, transport: input.transport });
        input.signal?.addEventListener('abort', () => { session.takeKeyAuthSecret()?.fill(0); }, { once: true });
        return {
            kind: 'authenticated',
            serviceKey: createAccountDirectoryServiceKey(target),
            service,
            session,
            credentialTokenDigest: await digestAccountDirectoryCredentialToken(credentials.token),
        };
    } catch (error) {
        if (input.signal?.aborted) return { kind: 'cancelled' };
        if (isAccountDirectoryRelinkConflict(error)) return { kind: 'relink_required', error };
        return { kind: 'failed', error };
    } finally {
        secret.fill(0);
    }
}

export async function authenticateSelectedAccountServiceWithGeneratedKey(input: Readonly<{
    service: VerifiedAccountServiceAuthority;
    signal?: AbortSignal;
    transport?: AccountDirectoryAuthTransport;
}>): Promise<AccountServiceKeyAuthOutcome> {
    if (input.signal?.aborted) return { kind: 'cancelled' };
    const secret = await getRandomBytesAsync(32);
    try {
        if (input.signal?.aborted) return { kind: 'cancelled' };
        return await authenticateSelectedAccountServiceWithKey({
            service: input.service,
            secret,
            signal: input.signal,
            transport: input.transport,
        });
    } finally {
        secret.fill(0);
    }
}

/**
 * Email and password sign-in to the selected account service. It reaches the same session and
 * post-auth continuation as key sign-in: the only difference is how the Directory credential is
 * obtained. An E2EE Account's unlocked key is held by the session exactly as a typed key is; a
 * Plain Account's session has none (the keyless OAuth shape).
 */
export async function authenticateSelectedAccountServiceWithPassword(input: Readonly<{
    service: VerifiedAccountServiceAuthority;
    email: string;
    password: string;
    signal?: AbortSignal;
    transport?: AccountDirectoryAuthTransport;
}>): Promise<AccountServiceKeyAuthOutcome> {
    if (input.signal?.aborted) return { kind: 'cancelled' };
    const { service } = input;
    let keyAuthSecret: Uint8Array | null = null;
    try {
        const signedIn = await accountDirectoryAuthClient.loginWithPassword({
            endpointUrl: service.endpointUrl,
            endpointServerIdentityId: service.serverIdentityId,
            canonicalServerUrl: service.canonicalServerUrl,
            email: input.email,
            password: input.password,
            signal: input.signal,
            ...input.transport,
            verifiedServerFeaturesSnapshot: service.snapshot,
        });
        keyAuthSecret = signedIn.keyAuthSecret;
        if (input.signal?.aborted) return { kind: 'cancelled' };
        const target = { endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId };
        const session = createAccountDirectorySession(target, {
            capability: service.capability,
            ...(keyAuthSecret ? { keyAuthSecret } : {}),
            transport: input.transport,
        });
        input.signal?.addEventListener('abort', () => { session.takeKeyAuthSecret()?.fill(0); }, { once: true });
        return {
            kind: 'authenticated',
            serviceKey: createAccountDirectoryServiceKey(target),
            service,
            session,
            credentialTokenDigest: await digestAccountDirectoryCredentialToken(signedIn.credentials.token),
        };
    } catch (error) {
        if (input.signal?.aborted) return { kind: 'cancelled' };
        if (isAccountDirectoryRelinkConflict(error)) return { kind: 'relink_required', error };
        return { kind: 'failed', error };
    } finally {
        keyAuthSecret?.fill(0);
    }
}

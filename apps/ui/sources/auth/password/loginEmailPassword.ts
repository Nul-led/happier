import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import type { ResolvedHomeAuthenticationTarget } from '@/auth/flows/resolveHomeAuthenticationTarget';
import type { HomeCarrier } from '@/sync/runtime/homeCarrier';
import { acceptPasswordTextV1, encodePasswordCredentialFieldV1 } from '@happier-dev/protocol';
import { authenticatePlainPassword, preloginEmailPassword, unlockEmailPassword } from '@/sync/api/auth/emailPassword';
import { createServerFetchAtEndpoint, type ServerFetch } from '@/sync/http/client';
import { HappyError } from '@/utils/errors/errors';

export type EmailPasswordLoginTarget = ResolvedHomeAuthenticationTarget & Readonly<{
    runtimeOrigin?: string;
    homeCarrier?: HomeCarrier;
}>;

export type EmailPasswordLoginInput = Readonly<{
    target: EmailPasswordLoginTarget;
    email: string;
    password: string;
    signal?: AbortSignal;
    isCurrent?: () => boolean;
}>;

export async function loginEmailPassword(input: EmailPasswordLoginInput): Promise<AuthCredentials> {
    const assertCurrent = () => {
        if (input.signal?.aborted || input.isCurrent?.() === false) {
            const error = new Error('Password authentication cancelled');
            error.name = 'AbortError';
            throw error;
        }
    };
    assertCurrent();
    const accepted = acceptPasswordTextV1(input.password);
    if (!accepted.accepted) {
        throw new HappyError('Password authentication failed', false, { kind: 'auth', code: 'authentication_failed' });
    }
    accepted.utf8.fill(0);
    const endpointRequest = createServerFetchAtEndpoint({ ...input.target, credentials: null, signal: input.signal });
    const request: ServerFetch = async (path, init, options) => {
        assertCurrent();
        const response = await endpointRequest(path, init, options);
        assertCurrent();
        return response;
    };
    const prelogin = await preloginEmailPassword(request, input.email);
    assertCurrent();
    if (prelogin.kind === 'plain_password') {
        const credentials = await authenticatePlainPassword(request, { v: 1, email: input.email, password: input.password });
        assertCurrent();
        return credentials;
    }

    // Password work is loaded only after submit selects the encrypted branch.
    const { derivePasswordKeys, openPasswordEnvelope, arePasswordEnvelopeKdfsEqual } = await import('./passwordEnvelope');
    assertCurrent();
    const keys = await derivePasswordKeys(input.password, prelogin.kdf, { signal: input.signal });
    let secret: Uint8Array | undefined;
    try {
        assertCurrent();
        const unlocked = await unlockEmailPassword(request, {
            v: 1, email: input.email, authKey: encodePasswordCredentialFieldV1(keys.authKey),
        });
        keys.authKey.fill(0);
        assertCurrent();
        if (!arePasswordEnvelopeKdfsEqual(prelogin.kdf, unlocked.envelope.kdf)) {
            throw new HappyError('Password authentication failed', false, { kind: 'auth', code: 'authentication_failed' });
        }
        secret = await openPasswordEnvelope(unlocked.envelope, keys.wrapKey);
        keys.wrapKey.fill(0);
        assertCurrent();
        const { authGetTokenAtEndpoint } = await import('@/auth/flows/getToken');
        assertCurrent();
        // Redeem the exact challenge the unlock boundary issued. It is the only
        // one carrying this Home's server-owned record that the password was
        // verified, so issuing a fresh one here would silently downgrade the
        // resulting credential to plain key-challenge provenance.
        const authenticated = await authGetTokenAtEndpoint({
            ...input.target,
            signal: input.signal,
            isCurrent: input.isCurrent,
            secret,
            expectedAccountId: unlocked.expectedAccountId,
            issuedChallenge: unlocked.challenge,
            requireKeyChallengeV2: true,
        });
        assertCurrent();
        return { token: authenticated.token, secret: encodePasswordCredentialFieldV1(secret) };
    } finally {
        keys.authKey.fill(0);
        keys.wrapKey.fill(0);
        secret?.fill(0);
    }
}

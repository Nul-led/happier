import {
    normalizeAccountDirectoryEndpoint,
    TokenStorage,
    type AuthCredentials,
} from '@/auth/storage/tokenStorage';
import { getAuthProvider } from '@/auth/providers/registry';
import { createServerFetchAtEndpoint } from '@/sync/http/client';
import { getRandomBytesAsync } from '@/platform/cryptoRandom';
import { digest } from '@/platform/digest';
import { encodeBase64 } from '@/encryption/base64';
import { encodeHex } from '@/encryption/hex';
import { deriveAccountSigningPublicKey } from '@/auth/flows/challenge';
import { authGetTokenAtEndpoint } from '@/auth/flows/getToken';

export type AccountDirectoryOAuthStartInput = Readonly<{
    endpointUrl: string;
    endpointServerIdentityId: string;
    providerId: string;
    mode: 'keyed' | 'keyless';
    returnTo?: string;
    /**
     * Optional stable identity of the currently authenticated Home, captured at login action
     * time. Only the identity is persisted on the continuation — never credentials or a
     * descriptor. Absent for fresh-device logins.
     */
    homeServerIdentityId?: string;
}>;

export type AccountDirectoryKeyLoginInput = Readonly<{
    endpointUrl: string;
    endpointServerIdentityId: string;
    secret: Uint8Array;
}>;

/**
 * Account Service authentication is intentionally explicit-targeted. These methods never
 * consult or mutate the focused Home runtime; callers decide when/where a discovered Home is
 * adopted.
 */
export const accountDirectoryAuthClient = {
    async loginWithKey(input: AccountDirectoryKeyLoginInput): Promise<AuthCredentials> {
        const endpointUrl = normalizeAccountDirectoryEndpoint(input.endpointUrl);
        const endpointServerIdentityId = input.endpointServerIdentityId.trim();
        if (!endpointUrl || !endpointServerIdentityId) {
            throw new Error('Account Service key login requires a known endpoint identity');
        }
        if (!(input.secret instanceof Uint8Array) || input.secret.length !== 32) {
            throw new Error('Account Service key login requires a 32-byte secret');
        }

        const credentials = await authGetTokenAtEndpoint({
            endpointUrl,
            canonicalServerUrl: endpointUrl,
            serverId: endpointServerIdentityId,
            serverIdentityId: endpointServerIdentityId,
            secret: input.secret,
            requireKeyChallengeV2: true,
            credentialTarget: 'account_directory',
        });
        const stored = await TokenStorage.accountDirectoryAuthCredentials.set(
            {
                endpoint: endpointUrl,
                serverIdentityId: endpointServerIdentityId,
            },
            credentials,
        );
        if (!stored) {
            throw new Error('Failed to persist Account Service credentials');
        }
        return credentials;
    },

    async startOAuth(input: AccountDirectoryOAuthStartInput): Promise<string> {
        const endpointUrl = normalizeAccountDirectoryEndpoint(input.endpointUrl);
        const endpointServerIdentityId = input.endpointServerIdentityId.trim();
        if (!endpointUrl || !endpointServerIdentityId) {
            throw new Error('Account Service OAuth requires a known endpoint identity');
        }
        const providerId = input.providerId.trim().toLowerCase();
        const provider = getAuthProvider(providerId);
        if (!provider) throw new Error('Unsupported Account Service OAuth provider');

        const secretBytes = input.mode === 'keyed'
            ? await getRandomBytesAsync(32)
            : null;
        const secret = secretBytes
            ? encodeBase64(secretBytes, 'base64url')
            : null;
        const proof = input.mode === 'keyless'
            ? encodeBase64(await getRandomBytesAsync(32), 'base64url')
            : null;
        const proofHash = proof
            ? encodeHex(await digest('SHA-256', new TextEncoder().encode(proof))).toLowerCase()
            : null;
        const publicKey = secretBytes
            ? encodeBase64(deriveAccountSigningPublicKey(secretBytes))
            : null;
        const request = createServerFetchAtEndpoint({
            endpointUrl,
            serverId: endpointServerIdentityId,
            credentials: null,
        });
        const homeServerIdentityId = input.homeServerIdentityId?.trim() ?? '';
        const start = await provider.getExternalAuthUrl(
            input.mode === 'keyed'
                ? { mode: 'keyed', publicKey: publicKey! }
                : { mode: 'keyless', proofHash: proofHash! },
            {
                request,
                purpose: 'account_directory',
                endpointUrl,
                endpointServerIdentityId,
            },
        );
        const stored = await TokenStorage.setPendingAccountDirectoryAuth({
            endpoint: endpointUrl,
            serverIdentityId: endpointServerIdentityId,
            credentialTarget: start.credentialTarget,
            provider: providerId,
            purpose: start.purpose,
            createdAt: Date.now(),
            expiresAt: start.expiresAt,
            mode: input.mode,
            ...(proof ? { proof } : {}),
            ...(secret ? { secret } : {}),
            ...(input.returnTo ? { returnTo: input.returnTo } : {}),
            ...(homeServerIdentityId ? { homeServerIdentityId } : {}),
        });
        if (!stored) {
            throw new Error('Failed to persist Account Service OAuth continuation');
        }
        return start.url;
    },
};

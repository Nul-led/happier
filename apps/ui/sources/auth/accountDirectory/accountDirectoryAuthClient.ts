import {
    normalizeAccountDirectoryEndpoint,
    isTokenOnlyAuthCredentials,
    TokenStorage,
    type AccountServiceEntryIntent,
    type TokenOnlyAuthCredentials,
} from '@/auth/storage/tokenStorage';
import { getAuthProvider } from '@/auth/providers/registry';
import { createServerFetchAtEndpoint } from '@/sync/http/client';
import { getRandomBytesAsync } from '@/platform/cryptoRandom';
import { digest } from '@/platform/digest';
import { encodeBase64 } from '@/encryption/base64';
import { encodeHex } from '@/encryption/hex';
import { deriveAccountSigningPublicKey } from '@/auth/flows/challenge';
import { authGetTokenAtEndpoint } from '@/auth/flows/getToken';
import { probeServerFeaturesAtUrl, type ServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import { AccountDirectoryCapabilitiesSchema, type AccountDirectoryCapabilities } from '@happier-dev/protocol';
import {
    normalizeAuthenticationProviderId,
    projectAuthenticationMethodCapabilities,
} from '@/auth/capabilities/authMethodCapabilities';

export type AccountDirectoryOAuthStartInput = Readonly<{
    endpointUrl: string;
    endpointServerIdentityId: string;
    canonicalServerUrl: string;
    providerId: string;
    mode: 'keyed' | 'keyless';
    entryIntent: AccountServiceEntryIntent;
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
    canonicalServerUrl: string;
    secret: Uint8Array;
}>;

export type AccountDirectoryRequestedAuthMethod =
    | Readonly<{ kind: 'key' }>
    | Readonly<{ kind: 'oauth'; providerId?: string | null }>;

export type AccountDirectoryAuthMethodDiscovery = Readonly<{
    endpointUrl: string;
    serverIdentityId: string;
    canonicalServerUrl: string;
    capability: AccountDirectoryCapabilities;
    keyLoginAvailable: boolean;
    oauthProviderIds: readonly string[];
    preferredProvisionProviderId: string | null;
}>;

export type AccountDirectoryAuthMethodDiscoveryResult =
    | Readonly<{
        kind: 'endpoint_unavailable';
        endpointUrl: string;
        reason: 'invalid_endpoint';
        snapshot?: never;
    }>
    | Readonly<{
        kind: 'endpoint_unavailable';
        endpointUrl: string;
        reason: 'probe_failed';
        snapshot: Exclude<ServerFeaturesSnapshot, { status: 'ready' }>;
    }>
    | Readonly<{
        kind: 'not_account_service';
        endpointUrl: string;
        serverIdentityId: string | null;
        snapshot: ServerFeaturesSnapshot & { status: 'ready' };
    }>
    | Readonly<{
        kind: 'identity_mismatch';
        endpointUrl: string;
        expectedServerIdentityId: string;
        observedServerIdentityId: string | null;
        snapshot: ServerFeaturesSnapshot & { status: 'ready' };
    }>
    | (Readonly<{ kind: 'supported_account_service' }> & AccountDirectoryAuthMethodDiscovery)
    | (Readonly<{
        kind: 'requested_method_unavailable';
        requestedMethod: AccountDirectoryRequestedAuthMethod;
    }> & AccountDirectoryAuthMethodDiscovery);

function parseAccountDirectoryCapability(value: unknown): AccountDirectoryCapabilities | null {
    const parsed = AccountDirectoryCapabilitiesSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

function requestedMethodAvailable(
    discovery: AccountDirectoryAuthMethodDiscovery,
    requestedMethod: AccountDirectoryRequestedAuthMethod | undefined,
): boolean {
    if (!requestedMethod) return true;
    if (requestedMethod.kind === 'key') return discovery.keyLoginAvailable;
    const providerId = normalizeAuthenticationProviderId(requestedMethod.providerId);
    if (!providerId) return discovery.preferredProvisionProviderId !== null;
    return discovery.oauthProviderIds.includes(providerId);
}

function buildSupportedDiscovery(
    endpointUrl: string,
    snapshot: ServerFeaturesSnapshot & { status: 'ready' },
    capability: AccountDirectoryCapabilities,
): AccountDirectoryAuthMethodDiscovery | null {
    const serverIdentityId = String(snapshot.serverIdentityId ?? snapshot.features.capabilities.serverIdentity.serverIdentityId ?? '').trim();
    const canonicalServerUrl = normalizeAccountDirectoryEndpoint(
        snapshot.features.capabilities.server.canonicalServerUrl ?? '',
    );
    if (!serverIdentityId || !canonicalServerUrl) return null;
    const authMethods = projectAuthenticationMethodCapabilities(snapshot.features);
    const oauthProviderIds = authMethods.usesStructuredMethods
        ? authMethods.configuredEnabledKeyedProvisionProviderIds
        : [];
    return {
        endpointUrl,
        serverIdentityId,
        canonicalServerUrl,
        capability,
        keyLoginAvailable: authMethods.keyChallengeV2Available,
        oauthProviderIds,
        preferredProvisionProviderId: oauthProviderIds[0] ?? null,
    };
}

/**
 * Account Service authentication is intentionally explicit-targeted. These methods never
 * consult or mutate the focused Home runtime; callers decide when/where a discovered Home is
 * adopted.
 */
export const accountDirectoryAuthClient = {
    async discoverAuthenticationMethods(input: Readonly<{
        endpointUrl: string;
        expectedServerIdentityId?: string | null;
        requestedMethod?: AccountDirectoryRequestedAuthMethod;
    }>): Promise<AccountDirectoryAuthMethodDiscoveryResult> {
        const endpointUrl = normalizeAccountDirectoryEndpoint(input.endpointUrl) ?? '';
        if (!endpointUrl) {
            return { kind: 'endpoint_unavailable', endpointUrl, reason: 'invalid_endpoint' };
        }
        const snapshot = await probeServerFeaturesAtUrl({ endpointUrl, force: true });
        if (snapshot.status !== 'ready') {
            return { kind: 'endpoint_unavailable', endpointUrl, reason: 'probe_failed', snapshot };
        }
        const serverIdentityId = String(snapshot.serverIdentityId ?? snapshot.features.capabilities.serverIdentity.serverIdentityId ?? '').trim() || null;
        const expectedServerIdentityId = String(input.expectedServerIdentityId ?? '').trim();
        if (expectedServerIdentityId && serverIdentityId !== expectedServerIdentityId) {
            return {
                kind: 'identity_mismatch',
                endpointUrl,
                expectedServerIdentityId,
                observedServerIdentityId: serverIdentityId,
                snapshot,
            };
        }
        const capability = parseAccountDirectoryCapability(snapshot.features.capabilities.accountDirectory);
        if (capability?.homeDirectory !== true) {
            return { kind: 'not_account_service', endpointUrl, serverIdentityId, snapshot };
        }
        const discovery = buildSupportedDiscovery(endpointUrl, snapshot, capability);
        if (!discovery) {
            return { kind: 'not_account_service', endpointUrl, serverIdentityId, snapshot };
        }
        if (!requestedMethodAvailable(discovery, input.requestedMethod)) {
            return {
                kind: 'requested_method_unavailable',
                requestedMethod: input.requestedMethod!,
                ...discovery,
            };
        }
        return { kind: 'supported_account_service', ...discovery };
    },

    async loginWithKey(input: AccountDirectoryKeyLoginInput): Promise<TokenOnlyAuthCredentials> {
        const endpointUrl = normalizeAccountDirectoryEndpoint(input.endpointUrl);
        const endpointServerIdentityId = input.endpointServerIdentityId.trim();
        const canonicalServerUrl = normalizeAccountDirectoryEndpoint(input.canonicalServerUrl);
        if (!endpointUrl || !endpointServerIdentityId || !canonicalServerUrl) {
            throw new Error('Account Service key login requires a known endpoint identity and canonical audience');
        }
        if (!(input.secret instanceof Uint8Array) || input.secret.length !== 32) {
            throw new Error('Account Service key login requires a 32-byte secret');
        }

        const credentials = await authGetTokenAtEndpoint({
            endpointUrl,
            canonicalServerUrl,
            serverId: endpointServerIdentityId,
            serverIdentityId: endpointServerIdentityId,
            secret: input.secret,
            requireKeyChallengeV2: true,
            credentialTarget: 'account_directory',
        });
        if (!isTokenOnlyAuthCredentials(credentials)) {
            throw new Error('Account Service returned non-Directory credentials');
        }
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
        const canonicalServerUrl = normalizeAccountDirectoryEndpoint(input.canonicalServerUrl);
        if (!endpointUrl || !endpointServerIdentityId || !canonicalServerUrl) {
            throw new Error('Account Service OAuth requires a known endpoint identity and canonical audience');
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
                canonicalServerUrl,
            },
        );
        const stored = await TokenStorage.setPendingAccountDirectoryAuth({
            endpoint: endpointUrl,
            serverIdentityId: endpointServerIdentityId,
            canonicalServerUrl,
            credentialTarget: start.credentialTarget,
            entryIntent: input.entryIntent,
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

import { authChallenge, authChallengeV2 } from './challenge';
import { encodeBase64 } from '@/encryption/base64';
import { Encryption } from '@/sync/encryption/encryption';
import sodium from '@/encryption/libsodium.lib';
import {
    getServerFeaturesSnapshot,
    probeServerFeaturesAtUrl,
    type ServerFeaturesSnapshot,
} from '@/sync/api/capabilities/serverFeaturesClient';
import {
    assertCurrentAccountStoredContentServerCompatibility,
} from '@/sync/api/capabilities/accountStoredContentCompatibility';
import * as serverHttp from '@/sync/http/client';
import type { ServerFetch, ServerFetchOptions } from '@/sync/http/client';
import {
    AuthErrorCodeSchema,
    canonicalizeKeyChallengeV2AudienceOrigin,
    KeyChallengeV2IssueResponseSchema,
    readServerEnabledBit,
    type KeyChallengeAuthRequest,
} from '@happier-dev/protocol';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { HappyError } from '@/utils/errors/errors';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';

const CONTENT_KEY_BINDING_PREFIX = new TextEncoder().encode('Happy content key v1\u0000');

type AuthRequest = (
    path: string,
    init?: RequestInit,
    options?: ServerFetchOptions,
) => Promise<Response>;

type AuthCredentialTarget = 'ordinary_home' | 'account_directory';

function resolveKeyAuthPaths(target: AuthCredentialTarget): Readonly<{
    challenge: string;
    redeem: string;
}> {
    return target === 'account_directory'
        ? {
            challenge: '/v1/auth/account-directory/challenge',
            redeem: '/v1/auth/account-directory',
        }
        : {
            challenge: '/v1/auth/challenge',
            redeem: '/v1/auth',
        };
}

type AuthTokenCoreParams = Readonly<{
    secret: Uint8Array;
    expectedAccountId?: string;
    expectedServerIdentityId?: string;
    requireKeyChallengeV2: boolean;
    credentialTarget: AuthCredentialTarget;
    request: AuthRequest;
    probe: () => Promise<ServerFeaturesSnapshot>;
    resolveAudience: (features: ServerFeaturesSnapshot & { status: 'ready' }) => Readonly<{
        origin: string;
        serverIdentityId: string;
    }>;
}>;

function readObservedServerIdentityId(
    snapshot: ServerFeaturesSnapshot & { status: 'ready' },
): string | null {
    return String(
        snapshot.serverIdentityId
        ?? snapshot.features.capabilities.serverIdentity.serverIdentityId
        ?? '',
    ).trim() || null;
}

function throwEndpointIdentityMismatch(): never {
    throw new HappyError(
        'Authentication failed: selected server identity does not match the endpoint.',
        false,
        { kind: 'auth' },
    );
}

function readNestedBoolean(
    value: unknown,
    path: readonly string[],
): boolean | undefined {
    let current: unknown = value;
    for (const segment of path) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return typeof current === 'boolean' ? current : undefined;
}

function resolveSelectedKeyChallengeV2Audience(): Readonly<{
    origin: string;
    serverIdentityId: string;
}> {
    const active = getActiveServerSnapshot();
    const profile = getServerProfileById(active.serverId);
    const origin = canonicalizeKeyChallengeV2AudienceOrigin(
        profile?.canonicalServerUrl ?? active.serverUrl ?? profile?.serverUrl,
    );
    if (!origin || !profile?.serverIdentityId) {
        throw new Error('Authentication failed: selected server identity is unavailable for key-challenge v2.');
    }
    return { origin, serverIdentityId: profile.serverIdentityId };
}

async function throwAuthenticationFailure(response: Pick<Response, 'status' | 'json'>): Promise<never> {
    let code: string | undefined;
    try {
        const payload = await response.json() as unknown;
        const candidate = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
            ? (payload as { error?: unknown }).error
            : undefined;
        const parsed = AuthErrorCodeSchema.safeParse(candidate);
        if (parsed.success) {
            code = parsed.data;
        }
    } catch {
        // A non-JSON failure still retains its HTTP classification below.
    }

    const isServerFailure = response.status >= 500;
    throw new HappyError(
        `Authentication failed: ${response.status}`,
        isServerFailure,
        {
            status: response.status,
            kind: isServerFailure ? 'server' : 'auth',
            ...(code ? { code } : {}),
        },
    );
}

function readAuthToken(payload: unknown): string {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Authentication failed: invalid auth response.');
    }
    const token = (payload as { token?: unknown }).token;
    if (typeof token !== 'string' || token.trim().length === 0) {
        throw new Error('Authentication failed: invalid auth response.');
    }
    return token;
}

async function authGetTokenCore(params: AuthTokenCoreParams): Promise<AuthCredentials> {
    const authPaths = resolveKeyAuthPaths(params.credentialTarget);
    const serverFeaturesSnapshot = await params.probe();
    if (params.expectedAccountId) {
        assertCurrentAccountStoredContentServerCompatibility(serverFeaturesSnapshot);
    }
    const mayUseReleasedV1Fallback =
        params.credentialTarget === 'ordinary_home'
        && params.expectedAccountId === undefined
        && !params.requireKeyChallengeV2;
    if (serverFeaturesSnapshot.status !== 'ready' && !mayUseReleasedV1Fallback) {
        throw new HappyError(
            'Authentication failed: server capability probe did not return a valid response.',
            true,
            {
                kind:
                    serverFeaturesSnapshot.status === 'error'
                    && serverFeaturesSnapshot.reason === 'response_status'
                        ? 'server'
                        : 'network',
            },
        );
    }
    const readyServerFeaturesSnapshot = serverFeaturesSnapshot.status === 'ready'
        ? serverFeaturesSnapshot
        : null;
    if (readyServerFeaturesSnapshot) {
        const observedServerIdentityId = readObservedServerIdentityId(
            readyServerFeaturesSnapshot,
        );
        if (
            params.expectedServerIdentityId
            && observedServerIdentityId !== params.expectedServerIdentityId
        ) {
            throwEndpointIdentityMismatch();
        }

        // Newer servers advertise this gate under the feature payload. Older
        // servers omit it, and omission remains compatible with v1 login.
        const keyChallengeEnabledRaw = readNestedBoolean(
            readyServerFeaturesSnapshot.features,
            ['features', 'auth', 'login', 'keyChallenge', 'enabled'],
        );
        if (keyChallengeEnabledRaw === false) {
            throw new Error('Authentication failed: key-challenge login is disabled on this server.');
        }
    }

    const supportsKeyChallengeV2 =
        readyServerFeaturesSnapshot?.features.capabilities.auth.keyChallenge.v2 === true;
    const requireKeyChallengeV2 =
        params.requireKeyChallengeV2
        || params.credentialTarget === 'account_directory';
    if (requireKeyChallengeV2 && !supportsKeyChallengeV2) {
        throw new Error('Authentication failed: key-challenge v2 is required for Account-bound login.');
    }

    let body: KeyChallengeAuthRequest;
    if (supportsKeyChallengeV2 && readyServerFeaturesSnapshot) {
        const issueResponse = await params.request(authPaths.challenge, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(
                params.expectedAccountId
                    ? { expectedAccountId: params.expectedAccountId }
                    : {},
            ),
        }, { includeAuth: false });
        if (!issueResponse.ok) {
            await throwAuthenticationFailure(issueResponse);
        }
        let issuePayload: unknown;
        try {
            issuePayload = await issueResponse.json();
        } catch {
            throw new Error('Authentication failed: invalid key-challenge v2 response.');
        }
        const parsedIssue = KeyChallengeV2IssueResponseSchema.safeParse(issuePayload);
        if (!parsedIssue.success) {
            throw new Error('Authentication failed: invalid key-challenge v2 response.');
        }
        const assertion = authChallengeV2(params.secret, {
            challenge: parsedIssue.data,
            expectedAudience: params.resolveAudience(readyServerFeaturesSnapshot),
            ...(params.expectedAccountId ? { expectedAccountId: params.expectedAccountId } : {}),
        });
        body = {
            challengeId: parsedIssue.data.challengeId,
            signature: encodeBase64(assertion.signature),
            publicKey: encodeBase64(assertion.publicKey),
            ...(params.expectedAccountId ? { expectedAccountId: params.expectedAccountId } : {}),
        };
    } else {
        const assertion = authChallenge(params.secret, params.expectedAccountId
            ? { expectedAccountId: params.expectedAccountId }
            : undefined);
        body = {
            challenge: encodeBase64(assertion.challenge),
            signature: encodeBase64(assertion.signature),
            publicKey: encodeBase64(assertion.publicKey),
            ...(params.expectedAccountId ? { expectedAccountId: params.expectedAccountId } : {}),
        };
    }

    // New content-key fields are sent only when negotiated, except for the
    // Account-bound flow where they are part of the binding contract.
    const supportsContentKeys = readyServerFeaturesSnapshot
        ? readServerEnabledBit(readyServerFeaturesSnapshot.features, 'sharing.contentKeys') === true
        : false;
    if (supportsContentKeys || params.expectedAccountId) {
        const encryption = await Encryption.create(params.secret);
        const contentPublicKey = encryption.contentDataKey;

        const signingKeyPair = sodium.crypto_sign_seed_keypair(params.secret);
        const binding = new Uint8Array(CONTENT_KEY_BINDING_PREFIX.length + contentPublicKey.length);
        binding.set(CONTENT_KEY_BINDING_PREFIX, 0);
        binding.set(contentPublicKey, CONTENT_KEY_BINDING_PREFIX.length);
        const contentPublicKeySig = sodium.crypto_sign_detached(binding, signingKeyPair.privateKey);

        body.contentPublicKey = encodeBase64(contentPublicKey);
        body.contentPublicKeySig = encodeBase64(contentPublicKeySig);
    }

    const response = await params.request(authPaths.redeem, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    }, { includeAuth: false });
    if (!response.ok) {
        await throwAuthenticationFailure(response);
    }
    const payload: unknown = await response.json();
    return { token: readAuthToken(payload) };
}

/**
 * Authenticate against the focused Home. This compatibility wrapper retains
 * the historical string return and focused-server feature probe; all protocol
 * and signing decisions live in `authGetTokenCore`.
 */
export async function authGetToken(
    secret: Uint8Array,
    options?: Readonly<{
        expectedAccountId: string;
    }>,
): Promise<string> {
    const credentials = await authGetTokenCore({
        secret,
        ...(options ? { expectedAccountId: options.expectedAccountId } : {}),
        requireKeyChallengeV2: Boolean(options),
        credentialTarget: 'ordinary_home',
        request: serverHttp.serverFetch,
        probe: async () => await getServerFeaturesSnapshot({
            timeoutMs: 800,
            // Always refresh the assertion scheme before login. A stale v1
            // snapshot must not keep an upgraded server on replayable v1.
            force: true,
        }),
        resolveAudience: resolveSelectedKeyChallengeV2Audience,
    });
    return credentials.token;
}

export type AuthGetTokenAtEndpointParams = Readonly<{
    endpointUrl: string;
    serverId?: string;
    canonicalServerUrl?: string;
    serverIdentityId?: string;
    expectedAccountId?: string;
    secret: Uint8Array;
    requireKeyChallengeV2: boolean;
    /** Selects the dedicated server-controlled restricted mint route. */
    credentialTarget?: 'account_directory';
}>;

/**
 * Authenticate against an explicitly selected Home/Account Service endpoint.
 * `canonicalServerUrl` is the stable v2 audience; any runtime transport origin
 * belongs only to the request factory and is never used for signing.
 */
export async function authGetTokenAtEndpoint(
    params: AuthGetTokenAtEndpointParams,
): Promise<AuthCredentials> {
    const canonicalUrl = String(params.canonicalServerUrl ?? params.endpointUrl ?? '').trim();
    const expectedServerIdentityId = String(params.serverIdentityId ?? '').trim() || null;
    const request = serverHttp.createServerFetchAtEndpoint({
        endpointUrl: params.endpointUrl,
        serverId: params.serverId,
        credentials: null,
    });
    return await authGetTokenCore({
        secret: params.secret,
        ...(params.expectedAccountId ? { expectedAccountId: params.expectedAccountId } : {}),
        ...(expectedServerIdentityId ? { expectedServerIdentityId } : {}),
        requireKeyChallengeV2: params.requireKeyChallengeV2,
        credentialTarget: params.credentialTarget ?? 'ordinary_home',
        request,
        probe: async () => await probeServerFeaturesAtUrl({
            endpointUrl: params.endpointUrl,
            serverId: params.serverId,
            force: true,
        }),
        resolveAudience: (snapshot) => {
            const origin = canonicalizeKeyChallengeV2AudienceOrigin(canonicalUrl);
            const observedIdentity = readObservedServerIdentityId(snapshot);
            if (!origin || !(expectedServerIdentityId ?? observedIdentity)) {
                throw new Error('Authentication failed: selected server identity is unavailable for key-challenge v2.');
            }
            return {
                origin,
                serverIdentityId: expectedServerIdentityId ?? observedIdentity!,
            };
        },
    });
}

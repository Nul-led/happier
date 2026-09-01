import * as privacyKit from "privacy-kit";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
    AccountEncryptionMigrateExternalAuthBindingDigestV1Schema,
    AuthTokenProvenanceSchema,
    parseAccountApiTokenBearerV1,
    type AuthTokenAuthority,
    type AuthTokenKind,
    type AuthTokenProvenance,
    type ParsedAccountApiTokenBearerV1,
} from "@happier-dev/protocol";
import { db } from "@/storage/db";
import { inTx, type Tx } from "@/storage/inTx";
import { log } from "@/utils/logging/log";
import { LRUTtlMap } from "@/utils/collections/lru";
import {
    isOAuthStateUnavailableError,
    OAuthStateUnavailableError,
} from "./oauthStateErrors";

interface TokenGeneratorLike {
    new: (payload: Readonly<{
        user?: string;
        extras?: Readonly<Record<string, unknown>>;
    }>) => Promise<string>;
    publicKey: Uint8Array | number[];
}

interface TokenVerifierLike {
    verify: (token: string) => Promise<any>;
}

// Persistent tokens have no expiry. Retain this read-only compatibility window until an
// explicit token epoch or forced re-auth retires tokens issued by privacy-kit 0.0.25 on Bun.
const LEGACY_BUN_SEED_CANDIDATE_COUNT = 64;
const HISTORICAL_LEGACY_TOKEN_MARKERS = new Set([
    "privacy-kit-0.0.25-node",
    "privacy-kit-0.0.25-bun-1.3.5",
]);

interface AuthTokens {
    generator: TokenGeneratorLike;
    verifier: TokenVerifierLike;
}

interface OAuthStateTokens {
    oauthStateVerifier: TokenVerifierLike;
    oauthStateGenerator: TokenGeneratorLike;
}

type OAuthStatePayload = Readonly<{
    flow: "connect" | "auth";
    provider: string;
    sid?: string | null;
    userId?: string | null;
    publicKey?: string | null;
    proofHash?: string | null;
    purpose?: "account_encryption_first_key" | "account_directory" | null;
    requestDigest?: string | null;
    endpointUrl?: string | null;
    endpointServerIdentityId?: string | null;
}>;

type DecodedAuthToken = Readonly<{
    userId: string;
    extras?: unknown;
    tokenEpoch: number;
    provenance: AuthTokenProvenance;
    legacy: boolean;
}>;

export type {
    AuthTokenAuthority,
    AuthTokenKind,
    AuthTokenProvenance,
} from "@happier-dev/protocol";

/** Backward-compatible server spelling retained for existing request callers. */
export type AuthAuthority = AuthTokenAuthority;

/** An explicit, complete mint decision; no endpoint, extras, or token shape
 * may infer it. The canonical kind/authority mapping is owned by the protocol
 * provenance schema. */
export type CreateTokenOptions = Readonly<{
    kind: AuthTokenKind;
    authority: AuthTokenAuthority;
}>;

/**
 * Server-verified PAT facts that may be projected only for the lifetime of
 * the request that authenticated the bearer. The plaintext PAT never leaves
 * the authorization header boundary.
 */
export type VerifiedApiTokenPrincipal = Readonly<{
    accountId: string;
    principalId: string;
    credentialId: string;
    authority: "account_automation";
    expiresAt: Date | null;
}>;

export type VerifiedAuthToken = Readonly<{
    userId: string;
    extras?: unknown;
    /** Canonical server-verified credential kind from the signed marker. */
    authTokenKind: AuthTokenKind;
    /** Canonical server-verified authority from the signed marker. */
    authority: AuthTokenAuthority;
    /** True only when the credential was accepted through the named
     * pre-marker ordinary-Home reader. Central admission consumes this fact
     * to deny a legacy credential on Directory-opt-in routes; a current
     * signed or database-minted credential is never legacy. */
    legacy: boolean;
    apiTokenPrincipal?: VerifiedApiTokenPrincipal;
}>;

export type CreatedApiToken = Readonly<{
    tokenId: string;
    /** Plaintext is returned only from this mint result and is never persisted. */
    token: string;
    label: string;
    displayPrefix: string;
    createdAt: Date;
    expiresAt: Date | null;
}>;

export type ApiTokenSummary = Readonly<{
    tokenId: string;
    label: string;
    displayPrefix: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
}>;

/**
 * PAT-only verification seam for server-owned introspection consumers. It
 * intentionally cannot verify a signed session token.
 */
export type VerifyPatResult =
    | Readonly<{
        ok: true;
        accountId: string;
        principalId: string;
        credentialId: string;
        expiresAt: Date | null;
        authority: "account_automation";
    }>
    | Readonly<{
        ok: false;
        reason: "invalid_token";
    }>;

type VerifiedApiToken = Readonly<{
    accountId: string;
    credentialId: string;
    expiresAt: Date | null;
}>;

/** The API adapter maps this canonical creation rejection to `invalid_request`. */
export class InvalidApiTokenExpiryError extends Error {
    constructor() {
        super("API token expiry must be in the future");
    }
}

const API_TOKEN_SECRET_BYTES = 32;
const API_TOKEN_DISPLAY_ID_LENGTH = 8;
// API-token verification may be high frequency. Five minutes bounds each valid
// token to one durable activity write per interval while retaining useful UI
// observability; revocation is still a row deletion checked on every request.
const API_TOKEN_LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

function isApiTokenCandidate(token: string): boolean {
    return token.startsWith("hap_");
}

function createApiTokenSecretDigest(secret: string): Buffer {
    return createHash("sha256").update(secret, "utf8").digest();
}

function apiTokenSecretDigestMatches(storedDigest: string, suppliedSecret: string): boolean {
    const stored = Buffer.from(storedDigest, "base64url");
    const supplied = createApiTokenSecretDigest(suppliedSecret);
    return stored.byteLength === supplied.byteLength && timingSafeEqual(stored, supplied);
}

function createApiTokenDisplayPrefix(tokenId: string): string {
    return `hap_v1_${tokenId.slice(0, API_TOKEN_DISPLAY_ID_LENGTH)}`;
}

function createApiTokenBearer(tokenId: string, secret: string): string {
    return `hap_v1_${tokenId}_${secret}`;
}

class AuthModule {
    private tokenCache: LRUTtlMap<string, DecodedAuthToken> | null = null;
    private tokens: AuthTokens | null = null;
    private oauthStateTokens: OAuthStateTokens | null = null;
    private oauthStateTokensInitPromise: Promise<OAuthStateTokens> | null = null;

    private resolveAuthTokenCacheTtlMsFromEnv(env: NodeJS.ProcessEnv): number {
        const raw = (env.AUTH_TOKEN_CACHE_TTL_SECONDS ?? "").toString().trim();
        const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
        const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 600;
        const clampedSeconds = Math.max(1, Math.min(86_400, seconds));
        return clampedSeconds * 1000;
    }

    private resolveAuthTokenCacheMaxEntriesFromEnv(env: NodeJS.ProcessEnv): number {
        const raw = (env.AUTH_TOKEN_CACHE_MAX_ENTRIES ?? "").toString().trim();
        const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
        const maxEntries = Number.isFinite(parsed) && parsed >= 0 ? parsed : 4096;
        return Math.max(0, Math.min(200_000, maxEntries));
    }
    
    private resolveOauthStateTtlMsFromEnv(env: NodeJS.ProcessEnv): number {
        const raw = (env.OAUTH_STATE_TTL_SECONDS ?? "").toString().trim();
        const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
        const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 600;
        const clampedSeconds = Math.max(60, Math.min(3600, seconds));
        return clampedSeconds * 1000;
    }

    private requireMasterSecret(env: NodeJS.ProcessEnv): string {
        const masterSecret = (env.HANDY_MASTER_SECRET ?? "").toString().trim();
        if (!masterSecret) {
            throw new Error("HANDY_MASTER_SECRET is required");
        }
        return masterSecret;
    }

    private deriveLegacyBunSeedCandidate(masterSecret: string, attempt: number): string {
        if (attempt === 0) {
            return masterSecret;
        }
        return createHash("sha256")
            .update(`happier-auth-seed-v1:${attempt}:${masterSecret}`)
            .digest("base64url");
    }

    private async createPersistentAuthTokens(masterSecret: string): Promise<AuthTokens> {
        const generator = await privacyKit.createPersistentTokenGenerator({
            service: "handy",
            seed: masterSecret,
        });
        const primaryVerifier = await privacyKit.createPersistentTokenVerifier({
            service: "handy",
            publicKey: Uint8Array.from(generator.publicKey),
        });

        const legacySeedCandidates = Array.from(
            { length: LEGACY_BUN_SEED_CANDIDATE_COUNT },
            (_, attempt) => this.deriveLegacyBunSeedCandidate(masterSecret, attempt),
        );
        const legacyKey =
            await privacyKit.resolveLegacyBunStandardBase64PersistentTokenPublicKey({
                service: "handy",
                seedCandidates: legacySeedCandidates,
            });

        if (!legacyKey || legacyKey.candidateIndex === 0) {
            return { generator, verifier: primaryVerifier };
        }

        const legacyVerifier = await privacyKit.createPersistentTokenVerifier({
            service: "handy",
            publicKey: legacyKey.publicKey,
        });
        log(
            { module: "auth", level: "warn" },
            `Historical Bun auth-token verification enabled (attempt=${legacyKey.candidateIndex})`,
        );

        return {
            generator,
            verifier: {
                verify: async (token: string) =>
                    (await primaryVerifier.verify(token)) ?? (await legacyVerifier.verify(token)),
            },
        };
    }

    private async getOauthStateTokens(): Promise<OAuthStateTokens> {
        if (this.oauthStateTokens) {
            return this.oauthStateTokens;
        }
        if (this.oauthStateTokensInitPromise) {
            return await this.oauthStateTokensInitPromise;
        }
        const masterSecret = this.requireMasterSecret(process.env);
        const oauthStateTtlMs = this.resolveOauthStateTtlMsFromEnv(process.env);
        this.oauthStateTokensInitPromise = (async () => {
            try {
                const oauthStateGenerator = await privacyKit.createEphemeralTokenGenerator({
                    service: "happier-oauth-state",
                    seed: masterSecret,
                    ttl: oauthStateTtlMs,
                });
                const oauthStateVerifier = await privacyKit.createEphemeralTokenVerifier({
                    service: "happier-oauth-state",
                    publicKey: Uint8Array.from(oauthStateGenerator.publicKey),
                });
                return { oauthStateGenerator, oauthStateVerifier };
            } catch (error) {
                const errorName =
                    error && typeof error === "object" && "name" in error
                        ? String(error.name)
                        : "unknown";
                log(
                    { module: "auth", level: "warn" },
                    `OAuth state backend unavailable (ephemeral token init failed; error=${errorName})`
                );
                throw new OAuthStateUnavailableError();
            }
        })();

        try {
            this.oauthStateTokens = await this.oauthStateTokensInitPromise;
            return this.oauthStateTokens;
        } finally {
            this.oauthStateTokensInitPromise = null;
        }
    }

    async init(): Promise<void> {
        if (this.tokens) {
            return; // Already initialized
        }
        
        log({ module: 'auth' }, 'Initializing auth module...');
        
        const masterSecret = this.requireMasterSecret(process.env);

        this.tokens = await this.createPersistentAuthTokens(masterSecret);

        const tokenCacheMaxEntries = this.resolveAuthTokenCacheMaxEntriesFromEnv(process.env);
        if (tokenCacheMaxEntries > 0) {
            const tokenCacheTtlMs = this.resolveAuthTokenCacheTtlMsFromEnv(process.env);
            this.tokenCache = new LRUTtlMap({
                maxSize: tokenCacheMaxEntries,
                ttlMs: tokenCacheTtlMs,
            });
        } else {
            this.tokenCache = null;
        }
        
        log({ module: 'auth' }, 'Auth module initialized');
    }
    
    async createToken(
        userId: string,
        extras: unknown | undefined,
        options: CreateTokenOptions,
    ): Promise<string> {
        const account = await db.account.findUnique({
            where: { id: userId },
            select: { tokenEpoch: true },
        });
        if (!account) {
            throw new Error("Cannot create auth token for an unknown account");
        }

        return this.createTokenWithEpoch(userId, account.tokenEpoch, extras, options);
    }

    /**
     * Server-internal Personal Home readiness proof. The transient token string is
     * never returned: this owner mints and verifies one ordinary present-user
     * token using the loaded Home secret, then exposes only typed facts.
     */
    async attestPresentUserTokenRoundTrip(): Promise<Readonly<{
        authenticated: true;
    }>> {
        const account = await db.account.findFirst({
            orderBy: { id: "asc" },
            select: { id: true },
        });
        if (!account) {
            throw new Error("Personal Home readiness requires an initialized Account");
        }
        const token = await this.createToken(account.id, undefined, {
            kind: "account",
            authority: "present_user",
        });
        const verified = await this.verifyToken(token);
        if (
            !verified
            || verified.userId !== account.id
            || verified.authTokenKind !== "account"
            || verified.authority !== "present_user"
            || verified.legacy
        ) {
            throw new Error("Personal Home authentication readiness attestation failed");
        }
        return { authenticated: true };
    }

    /** Account-auth completion uses the same serializable transaction for the
     * epoch read and the sealed-result CAS. The raw token remains transaction-local. */
    async createTokenInTx(
        tx: Tx,
        userId: string,
        extras: unknown | undefined,
        options: CreateTokenOptions,
    ): Promise<string> {
        const account = await tx.account.findUnique({
            where: { id: userId },
            select: { tokenEpoch: true },
        });
        if (!account) {
            throw new Error("Cannot create auth token for an unknown account");
        }

        return this.createTokenWithEpoch(userId, account.tokenEpoch, extras, options);
    }

    private async createTokenWithEpoch(
        userId: string,
        tokenEpoch: number,
        extras: unknown,
        options: CreateTokenOptions,
    ): Promise<string> {
        if (!this.tokens) {
            throw new Error('Auth module not initialized');
        }

        // Provenance is an explicit mint decision: no endpoint, extras, or
        // token shape may infer or default it. A missing or non-canonical
        // kind/authority pairing fails closed through the protocol owner;
        // API tokens remain exclusively database-minted.
        if (options?.kind === "api_token") {
            throw new Error("API tokens must be minted through createApiToken");
        }
        const provenance = AuthTokenProvenanceSchema.parse({
            v: 1,
            kind: options?.kind,
            authority: options?.authority,
        });

        return await this.tokens.generator.new({
            user: userId,
            extras: {
                ...this.asTokenExtras(extras),
                // `provenance` is a JWT top-level claim emitted by the token
                // generator, never caller-controlled nested extras.
                provenance,
                tokenEpoch,
            },
        });
    }

    /**
     * Mints an Account API token. Its plaintext bearer is intentionally
     * returned only here; all subsequent API-token operations use summaries.
     */
    async createApiToken(params: Readonly<{
        accountId: string;
        label: string;
        expiresAt?: Date | null;
    }>, nowInput: Date = new Date()): Promise<CreatedApiToken> {
        const accountId = params.accountId.trim();
        const label = params.label.trim();
        if (!accountId) {
            throw new Error("Cannot create an API token without an account id");
        }
        if (!label) {
            throw new Error("Cannot create an API token without a label");
        }

        const now = new Date(nowInput.getTime());
        const expiresAt = params.expiresAt == null
            ? null
            : new Date(params.expiresAt.getTime());
        if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now)) {
            throw new InvalidApiTokenExpiryError();
        }

        const account = await db.account.findUnique({
            where: { id: accountId },
            select: { id: true },
        });
        if (!account) {
            throw new Error("Cannot create an API token for an unknown account");
        }

        const tokenId = randomUUID();
        const secret = randomBytes(API_TOKEN_SECRET_BYTES).toString("base64url");
        const displayPrefix = createApiTokenDisplayPrefix(tokenId);
        const secretDigest = createApiTokenSecretDigest(secret).toString("base64url");
        const row = await db.accountApiToken.create({
            data: {
                id: tokenId,
                accountId,
                displayPrefix,
                secretDigest,
                label,
                createdAt: now,
                expiresAt,
            },
            select: {
                id: true,
                label: true,
                displayPrefix: true,
                createdAt: true,
                expiresAt: true,
            },
        });

        return {
            tokenId: row.id,
            token: createApiTokenBearer(tokenId, secret),
            label: row.label,
            displayPrefix: row.displayPrefix,
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
        };
    }

    /** Summaries deliberately omit the bearer secret and its stored digest. */
    async listApiTokens(accountId: string): Promise<readonly ApiTokenSummary[]> {
        const rows = await db.accountApiToken.findMany({
            where: { accountId: accountId.trim() },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                label: true,
                displayPrefix: true,
                createdAt: true,
                lastUsedAt: true,
                expiresAt: true,
            },
        });
        return rows.map((row) => ({
            tokenId: row.id,
            label: row.label,
            displayPrefix: createApiTokenDisplayPrefix(row.id),
            createdAt: row.createdAt,
            lastUsedAt: row.lastUsedAt,
            expiresAt: row.expiresAt,
        }));
    }

    /** Revocation is deletion: the next verification cannot find this selector. */
    async revokeApiToken(params: Readonly<{ accountId: string; tokenId: string }>): Promise<boolean> {
        const result = await db.accountApiToken.deleteMany({
            where: {
                id: params.tokenId,
                accountId: params.accountId.trim(),
            },
        });
        return result.count > 0;
    }

    /** Used by the present-user Action after its caller policy is registered. */
    async revokeAllApiTokens(accountId: string): Promise<number> {
        const result = await db.accountApiToken.deleteMany({
            where: { accountId: accountId.trim() },
        });
        return result.count;
    }

    /**
     * Verifies a current signed credential (or a PAT). Signed credentials must
     * carry the v1 provenance marker; pre-marker credentials are intentionally
     * not accepted on this canonical route-auth path.
     */
    async verifyToken(token: string): Promise<VerifiedAuthToken | null> {
        return this.verifyTokenInternal(token, { allowLegacyHome: false });
    }

    /**
     * Bounded compatibility reader for pre-marker ordinary Home credentials.
     * This is an explicit migration seam: it never admits PATs, Directory
     * credentials, or malformed/future markers and must not be used by generic
     * route admission.
     */
    async verifyLegacyHomeToken(token: string): Promise<VerifiedAuthToken | null> {
        const verified = await this.verifyTokenInternal(token, { allowLegacyHome: true });
        if (!verified || !verified.legacy || verified.authTokenKind !== "account") {
            return null;
        }
        return verified;
    }

    /** Route/socket compatibility boundary: strict current tokens first, then
     * the explicitly named pre-marker ordinary-Home reader. */
    async verifyTokenForRoute(token: string): Promise<VerifiedAuthToken | null> {
        return (await this.verifyToken(token)) ?? (await this.verifyLegacyHomeToken(token));
    }

    private async verifyTokenInternal(
        token: string,
        options: Readonly<{ allowLegacyHome: boolean }>,
    ): Promise<VerifiedAuthToken | null> {
        if (!this.tokens) {
            throw new Error('Auth module not initialized');
        }

        // API tokens have a reserved bearer prefix. A malformed token must not
        // fall through to the signed-token verifier or gain a second auth path.
        if (isApiTokenCandidate(token)) {
            if (options.allowLegacyHome) return null;
            const verifiedPat = await this.verifyPat(token);
            if (!verifiedPat.ok) {
                return null;
            }
            return {
                userId: verifiedPat.principalId,
                authTokenKind: "api_token",
                authority: verifiedPat.authority,
                legacy: false,
                apiTokenPrincipal: {
                    accountId: verifiedPat.accountId,
                    principalId: verifiedPat.principalId,
                    credentialId: verifiedPat.credentialId,
                    authority: verifiedPat.authority,
                    expiresAt: verifiedPat.expiresAt,
                },
            };
        }

        let decoded: DecodedAuthToken | null | undefined = this.tokenCache?.get(token);
        if (decoded?.legacy && !options.allowLegacyHome) {
            return null;
        }
        if (!decoded) {
            try {
                const verified = await this.tokens.verifier.verify(token);
                decoded = this.decodeAuthToken(verified, options);
            } catch {
                log({ module: "auth", level: "error" }, "Token verification failed");
                return null;
            }
            if (!decoded) {
                return null;
            }
            // The cache retains only data that passed cryptographic verification.
            this.tokenCache?.set(token, decoded);
        }

        // The account row is authoritative for revocation, including cache hits.
        const account = await db.account.findUnique({
            where: { id: decoded.userId },
            select: { tokenEpoch: true },
        });
        if (!account || decoded.tokenEpoch !== account.tokenEpoch) {
            return null;
        }

        return {
            userId: decoded.userId,
            extras: decoded.extras,
            authTokenKind: decoded.provenance.kind,
            authority: decoded.provenance.authority,
            legacy: decoded.legacy,
        };
    }

    /**
     * Verifies only the fixed PAT format for server-side introspection. The
     * typed negative result is deliberately opaque; route boundaries serialize
     * it as the same invalid_token response for every credential failure.
     */
    async verifyPat(token: string, signal?: AbortSignal): Promise<VerifyPatResult> {
        if (!this.tokens) {
            throw new Error('Auth module not initialized');
        }
        signal?.throwIfAborted();

        const parsed = parseAccountApiTokenBearerV1(token);
        if (!parsed) {
            return { ok: false, reason: "invalid_token" };
        }

        const verified = await this.verifyParsedApiToken(parsed, signal);
        if (!verified) {
            return { ok: false, reason: "invalid_token" };
        }
        return {
            ok: true,
            accountId: verified.accountId,
            principalId: verified.accountId,
            credentialId: verified.credentialId,
            expiresAt: verified.expiresAt,
            authority: "account_automation",
        };
    }

    async signOutEverywhere(userId: string): Promise<number> {
        // The epoch bump and PAT revocation are one sign-out decision. PAT rows
        // carry no per-credential epoch, so they are revoked through this
        // owner's existing deletion model at the same instant the epoch
        // invalidates signed tokens and cached verifications.
        return await inTx(async (tx) => {
            const account = await tx.account.update({
                where: { id: userId },
                data: { tokenEpoch: { increment: 1 } },
                select: { tokenEpoch: true },
            });
            await tx.accountApiToken.deleteMany({ where: { accountId: userId } });
            return account.tokenEpoch;
        });
    }

    private async verifyParsedApiToken(
        parsed: ParsedAccountApiTokenBearerV1,
        signal?: AbortSignal,
    ): Promise<VerifiedApiToken | null> {
        signal?.throwIfAborted();
        const row = await db.accountApiToken.findUnique({
            where: { id: parsed.tokenId },
            select: {
                id: true,
                accountId: true,
                secretDigest: true,
                expiresAt: true,
                lastUsedAt: true,
            },
        });
        signal?.throwIfAborted();
        if (!row || !apiTokenSecretDigestMatches(row.secretDigest, parsed.secret)) {
            return null;
        }

        const now = new Date();
        if (row.expiresAt && row.expiresAt <= now) {
            return null;
        }

        // The persistent Account row is the ownership and deletion check for
        // callers outside the Fastify eligibility gate.
        const account = await db.account.findUnique({
            where: { id: row.accountId },
            select: { id: true },
        });
        signal?.throwIfAborted();
        if (!account) {
            return null;
        }

        await this.recordApiTokenLastUse({
            tokenId: row.id,
            lastUsedAt: row.lastUsedAt,
            now,
        });
        signal?.throwIfAborted();
        return {
            accountId: row.accountId,
            credentialId: row.id,
            expiresAt: row.expiresAt,
        };
    }

    private async recordApiTokenLastUse(params: Readonly<{
        tokenId: string;
        lastUsedAt: Date | null;
        now: Date;
    }>): Promise<void> {
        const threshold = new Date(params.now.getTime() - API_TOKEN_LAST_USED_UPDATE_INTERVAL_MS);
        if (params.lastUsedAt && params.lastUsedAt > threshold) {
            return;
        }

        try {
            await db.accountApiToken.updateMany({
                where: {
                    id: params.tokenId,
                    OR: [
                        { lastUsedAt: null },
                        { lastUsedAt: { lte: threshold } },
                    ],
                },
                data: { lastUsedAt: params.now },
            });
        } catch {
            // Activity metadata must not become an availability dependency for
            // an otherwise valid API token, and this path never logs a bearer.
            log({ module: "auth", level: "warn" }, "API token last-used update failed");
        }
    }

    private decodeAuthToken(
        verified: unknown,
        options: Readonly<{ allowLegacyHome: boolean }>,
    ): DecodedAuthToken | null {
        if (typeof verified !== "object" || verified === null || Array.isArray(verified)) {
            return null;
        }

        const payload = verified as Readonly<Record<string, unknown>>;
        const userCandidate = payload.user ?? payload.userId;
        const userId = typeof userCandidate === "string" ? userCandidate.trim() : "";
        if (!userId) {
            return null;
        }

        const tokenExtras = this.asTokenExtras(payload.extras) ?? {};

        const hasTopLevelProvenance = Object.prototype.hasOwnProperty.call(payload, "provenance");
        const hasNestedProvenance = Object.prototype.hasOwnProperty.call(tokenExtras, "provenance");
        const rawProvenance = hasTopLevelProvenance
            ? payload.provenance
            : tokenExtras.provenance;

        let provenance: AuthTokenProvenance;
        let legacy = false;
        if (!hasTopLevelProvenance && !hasNestedProvenance) {
            if (!options.allowLegacyHome) return null;
            provenance = this.legacyAuthTokenProvenance(tokenExtras);
            legacy = true;
        } else if (this.isHistoricalLegacyTokenMarker(rawProvenance)) {
            if (!options.allowLegacyHome) return null;
            // privacy-kit 0.0.25 placed its implementation identifier in a
            // `provenance` string. It is a compatibility marker, not trusted
            // authority; the resulting token is always ordinary Home/terminal.
            provenance = this.legacyAuthTokenProvenance(tokenExtras);
            legacy = true;
        } else {
            const parsedProvenance = AuthTokenProvenanceSchema.safeParse(rawProvenance);
            if (!parsedProvenance.success) {
                return null;
            }
            // `api_token` is a database-backed bearer credential, not a
            // privacy-kit signed session. Never let a signed token impersonate
            // that direct consumer kind.
            if (parsedProvenance.data.kind === "api_token") {
                return null;
            }
            provenance = parsedProvenance.data;
        }

        const rawTokenEpoch = payload.tokenEpoch ?? tokenExtras.tokenEpoch;
        const tokenEpoch = rawTokenEpoch === undefined ? 0 : rawTokenEpoch;
        if (
            typeof tokenEpoch !== "number"
            || !Number.isSafeInteger(tokenEpoch)
            || tokenEpoch < 0
        ) {
            return null;
        }

        return {
            userId,
            extras: this.withoutProvenance(
                this.withoutTokenEpoch(tokenExtras),
                legacy,
            ),
            tokenEpoch,
            provenance,
            legacy,
        };
    }

    private legacyAuthTokenProvenance(
        extras: Readonly<Record<string, unknown>>,
    ): AuthTokenProvenance {
        const session = extras.session;
        const kind: AuthTokenKind =
            typeof session === "string" && session.trim()
                ? "terminal"
                : "account";
        return {
            v: 1,
            kind,
            authority: kind === "terminal" ? "account_automation" : "present_user",
        };
    }

    private isHistoricalLegacyTokenMarker(value: unknown): boolean {
        return typeof value === "string" && HISTORICAL_LEGACY_TOKEN_MARKERS.has(value);
    }

    private asTokenExtras(value: unknown): Readonly<Record<string, unknown>> | null {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            return null;
        }
        return value as Readonly<Record<string, unknown>>;
    }

    private withoutTokenEpoch(extras: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
        const { tokenEpoch: _tokenEpoch, ...publicExtras } = extras;
        return publicExtras;
    }

    private withoutProvenance(
        extras: Readonly<Record<string, unknown>>,
        legacy: boolean,
    ): Readonly<Record<string, unknown>> {
        if (legacy) return extras;
        const { provenance: _provenance, ...publicExtras } = extras;
        return publicExtras;
    }
    
    getCacheStats(): { size: number; oldestEntry: number | null } {
        if (!this.tokenCache || this.tokenCache.size === 0) {
            return { size: 0, oldestEntry: null };
        }

        return {
            size: this.tokenCache.size,
            oldestEntry: this.tokenCache.peekOldestAccessedAt()
        };
    }
    
    async createOauthStateToken(payload: OAuthStatePayload): Promise<string> {
        if (!this.tokens) {
            throw new Error("Auth module not initialized");
        }
        const oauthStateTokens = await this.getOauthStateTokens();

        const provider = payload.provider?.toString().trim().toLowerCase() ?? "";
        if (!provider) {
            throw new Error("Invalid OAuth provider");
        }

        const flow = payload.flow;
        if (flow !== "auth" && flow !== "connect") {
            throw new Error(`Invalid OAuth flow: ${String(flow)}`);
        }
        const sid = payload.sid?.toString().trim() || null;
        const userId = payload.userId?.toString().trim() || null;
        const publicKey = payload.publicKey?.toString().trim() || null;
        const proofHash = payload.proofHash?.toString().trim() || null;
        const purposeRaw = payload.purpose ?? null;
        if (
            purposeRaw !== null
            && purposeRaw !== "account_encryption_first_key"
            && purposeRaw !== "account_directory"
        ) {
            // The purpose union is closed and server-controlled. An unknown
            // purpose must never silently downgrade to an ordinary full-auth
            // state.
            throw new Error("Invalid OAuth purpose");
        }
        const purpose = purposeRaw;
        const endpointUrl = payload.endpointUrl?.toString().trim() || null;
        const endpointServerIdentityId =
            payload.endpointServerIdentityId?.toString().trim() || null;
        const requestDigestCandidate =
            AccountEncryptionMigrateExternalAuthBindingDigestV1Schema
                .safeParse(
                    payload.requestDigest
                        ?.toString()
                        .trim(),
                );
        const requestDigest =
            requestDigestCandidate.success
                ? requestDigestCandidate.data
                : null;
        if (
            purpose === "account_encryption_first_key"
            && (
                flow !== "auth"
                || !userId
                || !proofHash
                || !requestDigest
                || publicKey !== null
                || endpointUrl !== null
                || endpointServerIdentityId !== null
            )
        ) {
            throw new Error("Invalid OAuth first-key step-up binding");
        }
        if (
            purpose === "account_directory"
            && (
                flow !== "auth"
                || userId !== null
                || !endpointUrl
                || !endpointServerIdentityId
                || requestDigest !== null
                || ((publicKey === null) === (proofHash === null))
            )
        ) {
            throw new Error("Invalid OAuth account-directory binding");
        }
        if (
            purpose === null
            && (endpointUrl !== null || endpointServerIdentityId !== null)
        ) {
            // Endpoint binding fields only travel with the directory purpose.
            throw new Error("Invalid OAuth endpoint binding");
        }

        return await oauthStateTokens.oauthStateGenerator.new({
            user: "oauth-state",
            extras: {
                provider,
                flow,
                sid,
                userId,
                publicKey,
                proofHash,
                purpose,
                requestDigest,
                endpointUrl,
                endpointServerIdentityId,
            },
        });
    }

    async verifyOauthStateToken(token: string): Promise<{
        flow: "connect" | "auth";
        provider: string;
        sid: string | null;
        userId: string | null;
        publicKey: string | null;
        proofHash: string | null;
        purpose?: "account_encryption_first_key" | "account_directory";
        requestDigest?: string;
        endpointUrl?: string;
        endpointServerIdentityId?: string;
    } | null> {
        if (!this.tokens) {
            throw new Error("Auth module not initialized");
        }

        try {
            const oauthStateTokens = await this.getOauthStateTokens();
            const verified: any = await oauthStateTokens.oauthStateVerifier.verify(token);
            if (!verified) {
                return null;
            }

            if (verified.user !== "oauth-state") return null;
            const extras = verified.extras ?? {};
            const provider = typeof extras.provider === "string" ? extras.provider.trim().toLowerCase() : "";
            const flow = extras.flow === "auth" ? "auth" : extras.flow === "connect" ? "connect" : null;
            if (!provider || !flow) return null;
            const purposeRaw =
                typeof extras.purpose === "string" && extras.purpose.trim()
                    ? extras.purpose
                    : null;
            if (
                purposeRaw !== null
                && purposeRaw !== "account_encryption_first_key"
                && purposeRaw !== "account_directory"
            ) {
                // Unknown/future purpose markers fail closed instead of
                // degrading the continuation into an ordinary full-auth state.
                return null;
            }
            const purpose = purposeRaw;
            const endpointUrl =
                typeof extras.endpointUrl === "string" && extras.endpointUrl.trim()
                    ? extras.endpointUrl.trim()
                    : null;
            const endpointServerIdentityId =
                typeof extras.endpointServerIdentityId === "string" && extras.endpointServerIdentityId.trim()
                    ? extras.endpointServerIdentityId.trim()
                    : null;
            const userId =
                typeof extras.userId === "string" && extras.userId.trim()
                    ? extras.userId.trim()
                    : null;
            const publicKey =
                typeof extras.publicKey === "string" && extras.publicKey.trim()
                    ? extras.publicKey.trim()
                    : null;
            const proofHash =
                typeof extras.proofHash === "string" && extras.proofHash.trim()
                    ? extras.proofHash.trim()
                    : null;
            const requestDigestCandidate =
                AccountEncryptionMigrateExternalAuthBindingDigestV1Schema
                    .safeParse(
                        typeof extras.requestDigest
                            === "string"
                            ? extras.requestDigest.trim()
                            : null,
                    );
            const requestDigest =
                requestDigestCandidate.success
                    ? requestDigestCandidate.data
                    : null;
            if (
                purpose === "account_encryption_first_key"
                && (
                    flow !== "auth"
                    || !userId
                    || !proofHash
                    || !requestDigest
                    || publicKey !== null
                    || endpointUrl !== null
                    || endpointServerIdentityId !== null
                )
            ) {
                return null;
            }
            if (
                purpose === "account_directory"
                && (
                    flow !== "auth"
                    || userId !== null
                    || !endpointUrl
                    || !endpointServerIdentityId
                    || requestDigest !== null
                    || ((publicKey === null) === (proofHash === null))
                )
            ) {
                return null;
            }
            if (
                purpose === null
                && (endpointUrl !== null || endpointServerIdentityId !== null)
            ) {
                // Endpoint binding fields only travel with the directory purpose.
                return null;
            }

            return {
                flow,
                provider,
                sid: typeof extras.sid === "string" && extras.sid.trim() ? extras.sid.trim() : null,
                userId,
                publicKey,
                proofHash,
                ...(purpose ? { purpose } : {}),
                ...(purpose && requestDigest ? { requestDigest } : {}),
                ...(purpose === "account_directory" && endpointUrl
                    ? { endpointUrl }
                    : {}),
                ...(purpose === "account_directory" && endpointServerIdentityId
                    ? { endpointServerIdentityId }
                    : {}),
            };
        } catch (error) {
            if (isOAuthStateUnavailableError(error)) {
                return null;
            }
            // Avoid logging the raw token or verifier error payloads (which can include sensitive details).
            log({ module: "auth", level: "error" }, "OAuth state token verification failed");
            return null;
        }
    }

    // Cleanup old entries (optional - can be called periodically)
    cleanup(): void {
        this.tokenCache?.pruneExpired();

        const stats = this.getCacheStats();
        log({ module: 'auth' }, `Token cache size: ${stats.size} entries`);
    }
}

// Global instance
export const auth = new AuthModule();

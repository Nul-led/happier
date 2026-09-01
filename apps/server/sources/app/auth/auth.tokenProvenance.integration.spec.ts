import * as privacyKit from "privacy-kit";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { auth } from "@/app/auth/auth";
import { db } from "@/storage/db";
import {
    createLightSqliteHarness,
    type LightSqliteHarness,
} from "@/testkit/lightSqliteHarness";

const MASTER_SECRET = "auth-provenance-integration-secret";

function decodeJwtPayload(token: string): Record<string, unknown> {
    const encoded = token.split(".")[1];
    if (!encoded) throw new Error("token has no payload");
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
}

describe("auth token provenance (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-auth-provenance-",
            initAuth: true,
            env: {
                HANDY_MASTER_SECRET: MASTER_SECRET,
                AUTH_TOKEN_CACHE_MAX_ENTRIES: "64",
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
            },
        });
    }, 120_000);

    afterEach(async () => {
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    it("mints provenance as a signed top-level claim and projects every closed kind", async () => {
        const account = await db.account.create({
            data: { publicKey: "auth-provenance-all-kinds" },
            select: { id: true },
        });
        const cases = [
            { kind: "account" as const, authority: "present_user" as const },
            { kind: "terminal" as const, authority: "account_automation" as const },
            { kind: "account_directory" as const, authority: "present_user" as const },
        ];

        for (const expected of cases) {
            const token = await auth.createToken(account.id, { source: expected.kind }, expected);
            const payload = decodeJwtPayload(token);
            expect(payload).toMatchObject({
                sub: account.id,
                provenance: { v: 1, ...expected },
            });
            expect(payload.extras).toBeUndefined();
            expect(typeof payload.tokenEpoch).toBe("number");

            await expect(auth.verifyToken(token)).resolves.toMatchObject({
                userId: account.id,
                authTokenKind: expected.kind,
                authority: expected.authority,
                extras: { source: expected.kind },
                legacy: false,
            });
        }
    });

    it("self-attests the restored Home signing secret without exporting the temporary token", async () => {
        const account = await db.account.create({
            data: { publicKey: "auth-personal-home-readiness" },
            select: { id: true },
        });

        await expect(auth.attestPresentUserTokenRoundTrip()).resolves.toEqual({
            authenticated: true,
        });

        await db.account.deleteMany();
        await expect(auth.attestPresentUserTokenRoundTrip()).rejects.toThrow(
            "initialized Account",
        );
    });

    it("keeps signed provenance limited to version, kind, and authority", async () => {
        const account = await db.account.create({
            data: { publicKey: "auth-provenance-authentication-methods" },
            select: { id: true },
        });
        const token = await auth.createToken(account.id, undefined, {
            kind: "account",
            authority: "present_user",
        });
        expect(decodeJwtPayload(token).provenance).toEqual({
            v: 1,
            kind: "account",
            authority: "present_user",
        });
        await expect(auth.verifyToken(token)).resolves.toEqual(expect.objectContaining({
            userId: account.id,
            authTokenKind: "account",
            authority: "present_user",
            legacy: false,
        }));
    });

    it("requires an explicit complete provenance decision and rejects non-canonical pairings at mint time", async () => {
        const account = await db.account.create({
            data: { publicKey: "auth-provenance-explicit-mint" },
            select: { id: true },
        });
        // Loosely typed alias: a legacy caller omitting the mint decision must
        // fail closed at runtime even though TypeScript now rejects the call.
        const mintWithoutRequiredDecision = auth.createToken.bind(auth) as (
            userId: string,
            extras?: unknown,
            options?: unknown,
        ) => Promise<string>;

        await expect(mintWithoutRequiredDecision(account.id)).rejects.toThrow();
        // The historical extras.session inference must no longer mint anything.
        await expect(mintWithoutRequiredDecision(account.id, { session: "terminal-session" })).rejects.toThrow();
        await expect(mintWithoutRequiredDecision(account.id, undefined, undefined)).rejects.toThrow();

        // The canonical kind/authority mapping is enforced at mint time.
        await expect(auth.createToken(account.id, undefined, {
            kind: "terminal",
            authority: "present_user",
        })).rejects.toThrow();
        await expect(auth.createToken(account.id, undefined, {
            kind: "account",
            authority: "account_automation",
        })).rejects.toThrow();
        await expect(auth.createToken(account.id, undefined, {
            kind: "account_directory",
            authority: "account_automation",
        })).rejects.toThrow();
        // API tokens remain exclusively database-minted.
        await expect(auth.createToken(account.id, undefined, {
            kind: "api_token",
            authority: "account_automation",
        })).rejects.toThrow(/createApiToken/);
    });

    it("rejects missing, stripped, unknown, future, malformed, and semantically invalid markers on the strict verifier", async () => {
        const account = await db.account.create({
            data: { publicKey: "auth-provenance-invalid-markers" },
            select: { id: true },
        });
        const generator = await privacyKit.createPersistentTokenGenerator({
            service: "handy",
            seed: MASTER_SECRET,
        });
        const candidates: readonly Record<string, unknown>[] = [
            { tokenEpoch: 0 },
            { tokenEpoch: 0, provenance: { v: 2, kind: "account", authority: "present_user" } },
            { tokenEpoch: 0, provenance: { v: 1, kind: "unknown", authority: "present_user" } },
            { tokenEpoch: 0, provenance: { v: 1, kind: "account" } },
            { tokenEpoch: 0, provenance: { v: 1, kind: "account", authority: "present_user", mintOrigin: "unexpected" } },
            { tokenEpoch: 0, provenance: "not-a-provenance-marker" },
            { tokenEpoch: 0, provenance: null },
            // Semantically invalid pairings fail closed even though both fields
            // are individually known.
            { tokenEpoch: 0, provenance: { v: 1, kind: "terminal", authority: "present_user" } },
            { tokenEpoch: 0, provenance: { v: 1, kind: "account", authority: "account_automation" } },
            // `api_token` is a database-backed bearer credential; a signed
            // token claiming that kind is always rejected.
            { tokenEpoch: 0, provenance: { v: 1, kind: "api_token", authority: "account_automation" } },
        ];

        for (const extras of candidates) {
            const token = await generator.new({ user: account.id, extras });
            await expect(auth.verifyToken(token)).resolves.toBeNull();
        }

        // The explicit compatibility reader accepts only the pre-marker shape;
        // it must not become a second path for malformed/new restricted tokens.
        const legacyToken = await generator.new({
            user: account.id,
            extras: { tokenEpoch: 0 },
        });
        await expect(auth.verifyToken(legacyToken)).resolves.toBeNull();
        await expect(auth.verifyLegacyHomeToken(legacyToken)).resolves.toMatchObject({
            userId: account.id,
            authTokenKind: "account",
            authority: "present_user",
            legacy: true,
        });
        await expect(auth.verifyTokenForRoute(legacyToken)).resolves.toMatchObject({
            userId: account.id,
            authTokenKind: "account",
            authority: "present_user",
            legacy: true,
        });

        // A malformed new marker is never reinterpreted as a legacy credential.
        const futureMarkerToken = await generator.new({
            user: account.id,
            extras: { tokenEpoch: 0, provenance: { v: 2, kind: "account", authority: "present_user" } },
        });
        await expect(auth.verifyLegacyHomeToken(futureMarkerToken)).resolves.toBeNull();
        const nonCanonicalPairingToken = await generator.new({
            user: account.id,
            extras: { tokenEpoch: 0, provenance: { v: 1, kind: "terminal", authority: "present_user" } },
        });
        await expect(auth.verifyLegacyHomeToken(nonCanonicalPairingToken)).resolves.toBeNull();

        const directoryToken = await auth.createToken(account.id, undefined, {
            kind: "account_directory",
            authority: "present_user",
        });
        const currentHomeToken = await auth.createToken(account.id, undefined, {
            kind: "account",
            authority: "present_user",
        });
        await expect(auth.verifyLegacyHomeToken(currentHomeToken)).resolves.toBeNull();
        await expect(auth.verifyLegacyHomeToken(directoryToken)).resolves.toBeNull();
        await expect(auth.verifyTokenForRoute(directoryToken)).resolves.toMatchObject({
            userId: account.id,
            authTokenKind: "account_directory",
            legacy: false,
        });
    });

    it("rejects a cached Directory projection specifically when its epoch becomes stale", async () => {
        const account = await db.account.create({
            data: { publicKey: "auth-provenance-directory-epoch" },
            select: { id: true },
        });
        const token = await auth.createToken(account.id, undefined, {
            kind: "account_directory",
            authority: "present_user",
        });

        await expect(auth.verifyToken(token)).resolves.toMatchObject({
            userId: account.id,
            authTokenKind: "account_directory",
        });
        expect(auth.getCacheStats().size).toBeGreaterThan(0);

        await db.account.update({
            where: { id: account.id },
            data: { tokenEpoch: { increment: 1 } },
        });

        const currentToken = await auth.createToken(account.id, undefined, {
            kind: "account_directory",
            authority: "present_user",
        });
        await expect(auth.verifyToken(currentToken)).resolves.toMatchObject({
            userId: account.id,
            authTokenKind: "account_directory",
        });

        await expect(auth.verifyToken(token)).resolves.toBeNull();
        await expect(auth.verifyLegacyHomeToken(token)).resolves.toBeNull();
    });
});

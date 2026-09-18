import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import {
    consumeIdentityConnectionTestResultInTx,
    createIdentityConnectionTestResult,
} from "./identityConnectionTestResult";

describe("identity-connection OAuth test result", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-identity-connection-test-result-",
            initAuth: false,
        });
    });
    afterAll(async () => await harness.close());

    it("stores only bounded evidence and lets the initiating Account consume it once", async () => {
        const diagnostics = {
            subjectPresent: true,
            loginAvailable: true,
            emailAvailable: true,
            emailVerified: false,
            groups: { state: "complete" as const, count: 2 },
            eligibility: { status: "ineligible" as const, rules: [{ kind: "email_domains" as const, matched: false }] },
            mappedGroups: [{ id: "group-1", name: "Engineering" }],
        };
        const expiresAt = new Date(Date.now() + 60_000);
        const created = await createIdentityConnectionTestResult({
            initiatorAccountId: "admin-1",
            securityBinding: {
                provider: {
                    id: "provider-1",
                    source: "managed",
                    runtimeFingerprint: "runtime-7",
                    context: { kind: "team", teamId: "team-1" },
                },
                connection: { id: "connection-1", revision: 7 },
                admission: null,
                purpose: "identity_connection_test",
            },
            diagnostics,
            providerUserId: " subject-1 ",
            testedAt: new Date("2026-09-06T02:00:00.000Z"),
            expiresAt,
        });

        const persisted = await db.repeatKey.findUnique({ where: { key: created.key } });
        expect(persisted?.expiresAt).toEqual(expiresAt);
        expect(persisted?.value).not.toContain("access-token");
        expect(persisted?.value).not.toContain("raw-profile");

        const consumed = await inTx(async (tx) => await consumeIdentityConnectionTestResultInTx(tx, {
            resultHandle: created.resultHandle,
            initiatorAccountId: "admin-1",
        }));
        expect(consumed).toMatchObject({
            diagnostics,
            providerUserId: " subject-1 ",
            securityBinding: {
                provider: { id: "provider-1", runtimeFingerprint: "runtime-7" },
                connection: { id: "connection-1", revision: 7 },
            },
        });
        await expect(inTx(async (tx) => await consumeIdentityConnectionTestResultInTx(tx, {
            resultHandle: created.resultHandle,
            initiatorAccountId: "admin-1",
        }))).resolves.toBeNull();
    });

    it("invalidates a result presented by a different Account", async () => {
        const created = await createIdentityConnectionTestResult({
            initiatorAccountId: "admin-1",
            securityBinding: {
                provider: {
                    id: "provider-home",
                    source: "managed",
                    runtimeFingerprint: "runtime-home",
                    context: { kind: "home" },
                },
                connection: null,
                admission: null,
                purpose: "identity_connection_test",
            },
            providerUserId: "subject-2",
            testedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
        });
        await expect(inTx(async (tx) => await consumeIdentityConnectionTestResultInTx(tx, {
            resultHandle: created.resultHandle,
            initiatorAccountId: "admin-2",
        }))).resolves.toBeNull();
        await expect(inTx(async (tx) => await consumeIdentityConnectionTestResultInTx(tx, {
            resultHandle: created.resultHandle,
            initiatorAccountId: "admin-1",
        }))).resolves.toBeNull();
    });
});

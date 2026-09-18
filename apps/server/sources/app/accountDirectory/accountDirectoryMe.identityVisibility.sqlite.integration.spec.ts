import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { auth } from "@/app/auth/auth";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { readAccountDirectoryMe } from "./accountDirectoryService";

describe("Account Directory identity visibility (SQLite integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-account-directory-identity-",
            initAuth: false,
        });
        await auth.init();
    }, 120_000);

    afterAll(async () => {
        await harness.close();
    });

    afterEach(async () => {
        harness.resetEnv();
        vi.unstubAllGlobals();
        await harness.resetDbTables([
            () => db.accountIdentity.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    it("omits the native email login locator while retaining other authentication identities", async () => {
        const account = await db.account.create({
            data: { publicKey: "pk-account-directory-native-identity" },
            select: { id: true },
        });
        await db.accountIdentity.createMany({
            data: [
                {
                    accountId: account.id,
                    provider: "email",
                    providerUserId: "owner@example.test",
                    providerLogin: "owner@example.test",
                    profile: {},
                    showOnProfile: false,
                },
                {
                    accountId: account.id,
                    provider: "github",
                    providerUserId: "123",
                    providerLogin: "octocat",
                    profile: {},
                    showOnProfile: true,
                },
                {
                    accountId: account.id,
                    provider: "mtls",
                    providerUserId: "certificate-subject",
                    providerLogin: null,
                    profile: {},
                    showOnProfile: false,
                },
            ],
        });

        const result = await readAccountDirectoryMe(account.id);

        expect(result.linkedAuthenticationMethods).toEqual([
            { providerId: "github", login: "123" },
            { providerId: "mtls", login: "certificate-subject" },
        ]);
    });
});

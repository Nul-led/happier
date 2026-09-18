import { beforeEach, describe, expect, it, vi } from "vitest";

import { enforceLoginEligibility } from "@/app/auth/enforceLoginEligibility";

const {
    dbAccountFindUnique,
    dbAccountIdentityFindFirst,
    dbIdentityProviderInstanceFindUnique,
    dbTransaction,
} = vi.hoisted(() => ({
    dbAccountFindUnique: vi.fn(),
    dbAccountIdentityFindFirst: vi.fn(),
    dbIdentityProviderInstanceFindUnique: vi.fn(),
    dbTransaction: vi.fn(),
}));
vi.mock("@/storage/db", () => ({
    db: (() => {
        const boundary = {
            $transaction: (...args: any[]) => dbTransaction(...args),
            account: {
                findUnique: (...args: any[]) => dbAccountFindUnique(...args),
            },
            accountIdentity: {
                findFirst: (...args: any[]) => dbAccountIdentityFindFirst(...args),
            },
            identityProviderInstance: {
                findUnique: (...args: any[]) => dbIdentityProviderInstanceFindUnique(...args),
            },
        };
        dbTransaction.mockImplementation(async (operation: (tx: typeof boundary) => Promise<unknown>) => {
            return await operation(boundary);
        });
        return boundary;
    })(),
}));

vi.mock("@/utils/logging/log", () => ({
    log: vi.fn(),
}));

/**
 * The provider is resolved through the real asynchronous catalog: only the database and logging
 * boundaries are substituted, so a required provider that cannot be resolved or whose enforcement
 * fails must still fail closed.
 */
function envWithDeploymentProvider(): NodeJS.ProcessEnv {
    return {
        AUTH_REQUIRED_LOGIN_PROVIDERS: "acme",
        AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([
            {
                id: "acme",
                type: "oidc",
                displayName: "Acme",
                issuer: "https://issuer.example.test",
                clientId: "cid",
                clientAuthenticationMethod: "client_secret_post",
                clientSecret: "secret",
                redirectUrl: "https://server.example.test/v1/oauth/acme/callback",
            },
        ]),
    } as NodeJS.ProcessEnv;
}

describe("enforceLoginEligibility (provider failures)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbIdentityProviderInstanceFindUnique.mockResolvedValue(null);
    });

    it("fails closed with upstream_error when required provider runtime resolution throws", async () => {
        dbAccountFindUnique.mockResolvedValueOnce({ id: "acct-catalog-throws", status: "active" });
        dbTransaction.mockRejectedValueOnce(new Error("provider catalog unavailable"));

        await expect(
            enforceLoginEligibility({ accountId: "acct-catalog-throws", env: envWithDeploymentProvider() }),
        ).resolves.toEqual({ ok: false, statusCode: 503, error: "upstream_error" });
    });

    it("fails closed with upstream_error when a required provider enforcement throws", async () => {
        dbAccountFindUnique.mockResolvedValueOnce({ id: "acct-provider-throws", status: "active" });
        dbAccountIdentityFindFirst.mockRejectedValueOnce(new Error("provider down"));

        await expect(
            enforceLoginEligibility({ accountId: "acct-provider-throws", env: envWithDeploymentProvider() }),
        ).resolves.toEqual({ ok: false, statusCode: 503, error: "upstream_error" });
    });

    it("fails closed with upstream_error when a required provider is not in the catalog", async () => {
        dbAccountFindUnique.mockResolvedValueOnce({ id: "acct-provider-missing", status: "active" });

        await expect(
            enforceLoginEligibility({ accountId: "acct-provider-missing", env: { ...envWithDeploymentProvider(), AUTH_REQUIRED_LOGIN_PROVIDERS: "not-configured" } }),
        ).resolves.toEqual({ ok: false, statusCode: 503, error: "upstream_error" });
    });
});

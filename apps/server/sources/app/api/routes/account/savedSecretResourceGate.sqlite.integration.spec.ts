import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SavedSecretResourceActionErrorV1Schema } from "@happier-dev/protocol";
import { createAuthenticatedTestApp } from "@/app/api/testkit/sqliteFastify";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { registerSavedSecretResourceRoutes } from "./registerSavedSecretResourceRoutes";

/**
 * RED: with the generic `{ error: "not_found" }` gate, a disabled `teams`
 * feature answers Shared Saved Secret routes with a body outside the strict
 * SavedSecret vocabulary, so a client decoding the refusal meets a schema
 * rejection instead of a typed operation-scoped unavailability.
 * GREEN: the gate answers `{ error: "forbidden" }` (403), which parses with
 * SavedSecretResourceActionErrorV1Schema and fails closed before any read.
 */
describe("Saved Secret shared routes disabled-teams gate (SQLite integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "saved-secret-disabled-teams-gate-",
            env: { HAPPIER_FEATURE_TEAMS__ENABLED: "0" },
            initAuth: false,
        });
    }, 180_000);

    afterAll(async () => { await harness?.close(); });

    it("answers a disabled teams feature with the typed SavedSecret refusal", async () => {
        expect(SavedSecretResourceActionErrorV1Schema.safeParse({ error: "not_found" }).success).toBe(false);
        expect(SavedSecretResourceActionErrorV1Schema.safeParse({ error: "forbidden" }).success).toBe(true);
        const app = createAuthenticatedTestApp();
        registerSavedSecretResourceRoutes(app);
        await app.ready();
        try {
            const response = await app.inject({
                method: "GET",
                url: "/v1/account/saved-secrets/resources/materials",
                headers: { "x-test-user-id": "missing-actor" },
            });
            expect({ status: response.statusCode, body: response.json() }).toEqual({
                status: 403,
                body: { error: "forbidden" },
            });
            expect(SavedSecretResourceActionErrorV1Schema.safeParse(response.json()).success).toBe(true);
        } finally {
            await app.close();
        }
    });
});

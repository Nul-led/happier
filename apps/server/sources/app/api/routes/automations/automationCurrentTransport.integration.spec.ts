import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { withAuthenticatedTestApp } from "../../testkit/sqliteFastify";
import { automationRoutes } from "./automationRoutes";
import { AUTOMATION_TEMPLATE_V02_PLAIN } from "../../../../../../../packages/protocol/src/automations/automationTemplateV02.testFixtures";

describe("Automation current transport and retained 0.2 data", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-current-automation-transport-",
            env: { HAPPIER_FEATURE_AUTOMATIONS__ENABLED: "1" },
        });
    }, 120_000);

    afterAll(async () => await harness.close());

    it("reads unchanged 0.2-created templates and schedules through V3 while V2 routes are absent", async () => {
        const account = await db.account.create({ data: { encryptionMode: "plain" } });
        // The pinned bytes come from the actual 0.2 UI writer, not current types.
        const automation = await db.automation.create({ data: {
            accountId: account.id,
            name: "Retained release review",
            targetType: "new_session",
            templateCiphertext: AUTOMATION_TEMPLATE_V02_PLAIN,
            templateVersion: 1,
            triggers: { create: {
                kind: "schedule", enabled: true, scheduleKind: "interval", everyMs: 60_000,
            } },
        } });
        await withAuthenticatedTestApp(automationRoutes, async (app) => {
            const headers = { "x-test-user-id": account.id };
            const list = await app.inject({ method: "GET", url: "/v3/automations", headers });
            expect(list.statusCode).toBe(200);
            expect(list.json().automations).toEqual([expect.objectContaining({ id: automation.id })]);
            const detail = await app.inject({ method: "GET", url: `/v3/automations/${automation.id}`, headers });
            expect(detail.statusCode).toBe(200);
            expect(detail.json()).toMatchObject({
                id: automation.id,
                templateCiphertext: AUTOMATION_TEMPLATE_V02_PLAIN,
                triggers: [{ kind: "schedule", schedule: { kind: "interval", everyMs: 60_000 } }],
            });
            for (const [method, url] of [
                ["GET", "/v2/automations"], ["POST", "/v2/automations"],
                ["GET", `/v2/automations/${automation.id}`], ["PATCH", `/v2/automations/${automation.id}`],
                ["DELETE", `/v2/automations/${automation.id}`],
                ["POST", `/v2/automations/${automation.id}/pause`],
                ["POST", `/v2/automations/${automation.id}/resume`],
                ["POST", `/v2/automations/${automation.id}/run-now`],
                ["POST", `/v2/automations/${automation.id}/assignments`],
                ["GET", `/v2/automations/${automation.id}/runs`],
                ["GET", "/v2/automations/daemon/assignments"],
                ["POST", "/v2/automations/runs/claim"],
                ["POST", "/v2/automations/runs/run/heartbeat"],
                ["POST", "/v2/automations/runs/run/start"],
                ["POST", "/v2/automations/runs/run/succeed"],
                ["POST", "/v2/automations/runs/run/fail"],
                ["POST", "/v2/automations/runs/run/cancel"],
            ] as const) {
                const response = await app.inject({ method, url, headers });
                expect(response.statusCode, `${method} ${url}`).toBe(404);
            }
        });
        expect((await db.automation.findUniqueOrThrow({ where: { id: automation.id } })).templateCiphertext)
            .toBe(AUTOMATION_TEMPLATE_V02_PLAIN);
    });
});

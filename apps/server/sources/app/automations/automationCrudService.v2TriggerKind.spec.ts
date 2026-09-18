import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeAutomationStoredDefinitionExecutionRecipeV1 } from "@happier-dev/protocol";

import type { Tx } from "@/storage/inTx";

const mocks = vi.hoisted(() => ({
    inTx: vi.fn(),
    afterTx: vi.fn(),
    automationFindFirst: vi.fn(),
    automationFindMany: vi.fn(),
    automationFindUnique: vi.fn(),
    automationUpdateMany: vi.fn(),
    automationTriggerCreate: vi.fn(),
    automationTriggerUpdateMany: vi.fn(),
    accountUpdate: vi.fn(),
    accountChangeUpsert: vi.fn(),
    acquireAccountEncryptionTransitionFenceInTx: vi.fn(),
}));

vi.mock("@/storage/inTx", () => ({
    inTx: mocks.inTx,
    afterTx: mocks.afterTx,
}));
vi.mock("@/storage/db", () => ({
    db: { automation: { findMany: mocks.automationFindMany } },
}));
vi.mock("@/app/encryption/accountEncryptionTransition", () => ({
    acquireAccountEncryptionTransitionFenceInTx:
        mocks.acquireAccountEncryptionTransitionFenceInTx,
}));

import { getAutomation, listAutomations, updateAutomation } from "./automationCrudService";
import { toAutomationV2ApiDto } from "./automationApiProjection";

const strictRecipe = serializeAutomationStoredDefinitionExecutionRecipeV1({
    v: 1,
    templateVersion: 3,
    template: { t: "plain", v: { v: 1, prompt: "current V3 definition" } },
    triggerEvidence: null,
    target: {
        kind: "newSession",
        spawn: {
            executionTarget: { serverId: "server", machineId: "machine" },
            directory: "/tmp/v3-definition",
            agentTarget: {
                kind: "agent",
                identity: { pluginId: "happier.agent.codex", localId: "codex" },
            },
        },
    },
});
if (strictRecipe.kind !== "available") {
    throw new Error("Expected strict V3 fixture to serialize");
}
const strictRecipeSerialized = strictRecipe.serialized;

function strictScheduleDefinition() {
    return {
        id: "strict-schedule",
        accountId: "account-1",
        name: "Current V3 schedule",
        description: null,
        enabled: true,
        targetType: "new_session" as const,
        templateCiphertext: strictRecipeSerialized,
        templateVersion: 3,
        lastRunAt: null,
        createdAt: new Date("2026-08-10T12:00:00.000Z"),
        updatedAt: new Date("2026-08-10T12:00:00.000Z"),
        assignments: [],
        triggers: [scheduleTrigger("strict-schedule", "strict-schedule-trigger")],
    };
}

function scheduleTrigger(automationId: string, id: string) {
    const at = new Date("2026-08-10T12:00:00.000Z");
    return {
        id,
        automationId,
        kind: "schedule" as const,
        enabled: true,
        revision: 1,
        deletedAt: null,
        scheduleKind: "interval" as const,
        scheduleExpr: null,
        everyMs: 60_000,
        timezone: null,
        nextRunAt: null,
        eventPluginId: null,
        eventLocalId: null,
        sourceSelectorId: null,
        sourceContractVersion: null,
        observationTransport: null,
        webhookEndpointId: null,
        observationStartsAt: null,
        watcherMachineId: null,
        watcherMachineInstallationId: null,
        watcherPluginId: null,
        watcherMaterializationId: null,
        definitionEnvelope: null,
        sessionLifecycleEventsJson: null,
        sessionLifecyclePolicyKind: null,
        sessionLifecycleMatchCount: null,
        remainingOccurrences: null,
        sourceSessionId: null,
        sourceTurnId: null,
        createdAt: at,
        updatedAt: at,
        eventSourceStatus: null,
    };
}

const releasedV2TemplateEnvelope = JSON.stringify({
    kind: "happier_automation_template_plain_v1",
    payload: { prompt: "released V2" },
});

/** One retained released-V2 manual definition: zero automatic trigger rows. */
function releasedV2ManualDefinition() {
    return {
        ...strictScheduleDefinition(),
        id: "automation-1",
        name: "Released V2 manual",
        templateCiphertext: releasedV2TemplateEnvelope,
        assignments: [{ machineId: "machine-1", enabled: true, priority: 0, updatedAt: null }],
        triggers: [],
    };
}

function createTransaction(): Tx {
    return {
        automation: {
            findFirst: mocks.automationFindFirst,
            findUnique: mocks.automationFindUnique,
            updateMany: mocks.automationUpdateMany,
        },
        automationTrigger: {
            create: mocks.automationTriggerCreate,
            updateMany: mocks.automationTriggerUpdateMany,
        },
        account: {
            update: mocks.accountUpdate,
        },
        accountChange: {
            upsert: mocks.accountChangeUpsert,
        },
    } as unknown as Tx;
}

describe("V2 Automation released-V2 manual representability", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.automationFindFirst.mockResolvedValue(null);
        mocks.automationFindMany.mockResolvedValue([]);
        mocks.automationFindUnique.mockResolvedValue(null);
        mocks.automationUpdateMany.mockResolvedValue({ count: 0 });
        mocks.automationTriggerUpdateMany.mockResolvedValue({ count: 0 });
        mocks.accountUpdate.mockResolvedValue({ seq: 1 });
        mocks.accountChangeUpsert.mockResolvedValue({});
        mocks.acquireAccountEncryptionTransitionFenceInTx.mockResolvedValue({
            status: "ready",
        });
        mocks.inTx.mockImplementation(async (operation: (tx: Tx) => Promise<unknown>) => (
            await operation(createTransaction())
        ));
    });

    it.each([
        ["multiple schedules", [scheduleTrigger("automation-1", "schedule-1"), scheduleTrigger("automation-1", "schedule-2")]],
        ["a non-schedule trigger", [{ ...scheduleTrigger("automation-1", "event-1"), kind: "pluginEvent" as const }]],
    ] as const)("does not expose or mutate a definition with %s", async (_label, triggers) => {
        mocks.automationFindFirst.mockResolvedValue({
            ...releasedV2ManualDefinition(),
            triggers,
        });

        await expect(getAutomation({
            accountId: "account-1",
            automationId: "automation-1",
            requireV2DefinitionRepresentability: true,
        })).resolves.toBeNull();
        await expect(updateAutomation({
            accountId: "account-1",
            automationId: "automation-1",
            input: { name: "must not mutate" },
            requireV2DefinitionRepresentability: true,
        })).resolves.toBeNull();

        expect(mocks.automationUpdateMany).not.toHaveBeenCalled();
    });

    it("exposes and updates a zero-trigger definition as released V2 manual", async () => {
        const definition = releasedV2ManualDefinition();
        mocks.automationFindFirst.mockResolvedValue(definition);
        mocks.automationFindMany.mockResolvedValue([definition]);
        mocks.automationUpdateMany.mockResolvedValue({ count: 1 });
        mocks.automationFindUnique.mockResolvedValue({
            id: "automation-1",
            accountId: "account-1",
            enabled: true,
            deletedAt: null,
            triggers: [],
        });

        const loaded = await getAutomation({
            accountId: "account-1",
            automationId: "automation-1",
            requireV2DefinitionRepresentability: true,
        });
        expect(loaded).not.toBeNull();
        expect(loaded?.triggers).toEqual([]);
        expect(toAutomationV2ApiDto(loaded!).schedule).toEqual({
            kind: "manual",
            scheduleExpr: null,
            everyMs: null,
            timezone: null,
        });

        await expect(listAutomations({
            accountId: "account-1",
            requireV2DefinitionRepresentability: true,
        })).resolves.toEqual([
            expect.objectContaining({ id: "automation-1", triggers: [] }),
        ]);

        const updated = await updateAutomation({
            accountId: "account-1",
            automationId: "automation-1",
            input: { name: "Renamed through V2" },
            requireV2DefinitionRepresentability: true,
        });
        expect(updated).not.toBeNull();
        expect(updated?.triggers).toEqual([]);
        expect(toAutomationV2ApiDto(updated!).schedule).toEqual({
            kind: "manual",
            scheduleExpr: null,
            everyMs: null,
            timezone: null,
        });

        // The V2 write follows the representability-guarded definition
        // mutation, never an unguarded bypass, and keeps zero trigger rows.
        expect(mocks.automationUpdateMany).toHaveBeenCalledTimes(1);
        expect(mocks.automationUpdateMany.mock.calls[0][0].where).toMatchObject({
            id: "automation-1",
            accountId: "account-1",
            targetType: "new_session",
            templateCiphertext: releasedV2TemplateEnvelope,
        });
        expect(mocks.automationUpdateMany.mock.calls[0][0].data).toMatchObject({
            name: "Renamed through V2",
        });
        expect(mocks.automationTriggerCreate).not.toHaveBeenCalled();
        expect(mocks.automationTriggerUpdateMany).not.toHaveBeenCalled();
    });

    it("does not expose or mutate a strict V3 schedule definition through the V2 service boundary", async () => {
        mocks.automationFindFirst.mockResolvedValue(strictScheduleDefinition());

        await expect(getAutomation({
            accountId: "account-1",
            automationId: "strict-schedule",
            requireV2DefinitionRepresentability: true,
        })).resolves.toBeNull();

        await expect(updateAutomation({
            accountId: "account-1",
            automationId: "strict-schedule",
            input: { name: "must not mutate current V3" },
            requireV2DefinitionRepresentability: true,
        })).resolves.toBeNull();

        expect(mocks.automationUpdateMany).not.toHaveBeenCalled();
    });
});

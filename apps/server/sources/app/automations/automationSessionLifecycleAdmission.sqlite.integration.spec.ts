import { randomUUID } from "node:crypto";
import {
    MAX_NON_TERMINAL_EVENT_CONVERSATION_RUNS_PER_ACCOUNT,
    serializeAutomationStoredDefinitionExecutionRecipeV1,
} from "@happier-dev/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    applySessionTurnMutation as applySessionTurnMutationWithAuthentication,
    updateSessionAgentState,
} from "@/app/session/sessionWriteService";
import { createPresentUserSessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication.testkit";
import { eventRouter } from "@/app/events/eventRouter";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createSignedAccountContentBinding } from "@/testkit/accountEncryption";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { automationPortableQueryChunks } from "./automationPortableQueryChunks";
import { admitSessionLifecycleAutomationRunsTx } from "./automationSessionLifecycleAdmission";
import { encodeAutomationSessionLifecycleConfiguration } from "./automationSessionLifecycleConfigurationCodec";

const authentication = createPresentUserSessionAccessAuthentication();

function applySessionTurnMutation(
    params: Omit<Parameters<typeof applySessionTurnMutationWithAuthentication>[0], "authentication">,
) {
    return applySessionTurnMutationWithAuthentication({ ...params, authentication });
}

function failRunCreate(automationId: string) {
    const mutable = db as any;
    const original = mutable.$transaction;
    mutable.$transaction = async (...args: unknown[]) => {
        const operation = args[0];
        if (typeof operation !== "function") return await Reflect.apply(original, mutable, args);
        return await Reflect.apply(original, mutable, [async (tx: any) => {
            const runs = new Proxy(tx.automationRun, {
                get(target, property, receiver) {
                    if (property !== "create") return Reflect.get(target, property, receiver);
                    return (...createArgs: unknown[]) => {
                        const query = createArgs[0] as { data?: { automationId?: unknown } } | undefined;
                        if (query?.data?.automationId === automationId) throw new Error("injected Run persistence crash");
                        return Reflect.apply(target.create, target, createArgs);
                    };
                },
            });
            return await operation(new Proxy(tx, {
                get(target, property, receiver) {
                    return property === "automationRun" ? runs : Reflect.get(target, property, receiver);
                },
            }));
        }, ...args.slice(1)]);
    };
    return () => { mutable.$transaction = original; };
}

/**
 * Injects one canonical occurrence-uniqueness collision on the first Run
 * insert for an Automation. The database unique constraint is the admission
 * concurrency owner, so a concurrent winner must restart the settlement
 * transaction and rejoin rather than failing terminal Session settlement.
 */
function failFirstRunCreateWithOccurrenceConflict(automationId: string) {
    const mutable = db as any;
    const original = mutable.$transaction;
    let injected = false;
    mutable.$transaction = async (...args: unknown[]) => {
        const operation = args[0];
        if (typeof operation !== "function") return await Reflect.apply(original, mutable, args);
        return await Reflect.apply(original, mutable, [async (tx: any) => {
            const runs = new Proxy(tx.automationRun, {
                get(target, property, receiver) {
                    if (property !== "create") return Reflect.get(target, property, receiver);
                    return (...createArgs: unknown[]) => {
                        const query = createArgs[0] as { data?: { automationId?: unknown } } | undefined;
                        if (!injected && query?.data?.automationId === automationId) {
                            injected = true;
                            throw Object.assign(new Error("Unique constraint failed"), {
                                code: "P2002",
                                meta: { target: ["automationId", "occurrenceKey"] },
                            });
                        }
                        return Reflect.apply(target.create, target, createArgs);
                    };
                },
            });
            return await operation(new Proxy(tx, {
                get(target, property, receiver) {
                    return property === "automationRun" ? runs : Reflect.get(target, property, receiver);
                },
            }));
        }, ...args.slice(1)]);
    };
    return {
        restore: () => { mutable.$transaction = original; },
        didInject: () => injected,
    } as const;
}

describe("Session lifecycle Automation admission on SQLite", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-session-lifecycle-admission-",
            sqliteConnectionLimit: 2,
            initAuth: true,
            initEncrypt: false,
            initFiles: false,
        });
    }, 120_000);
    beforeEach(() => harness.resetEnv());
    afterAll(async () => await harness.close());

    async function source(params: Readonly<{
        agentId?: string;
        agentTurnId?: string;
        /** An E2EE Account whose content-key binding is absent is not current. */
        inconsistentE2ee?: boolean;
    }> = {}) {
        const suffix = randomUUID();
        const account = await db.account.create({
            data: params.inconsistentE2ee === true
                ? {
                    publicKey: createSignedAccountContentBinding().publicKey,
                    encryptionMode: "e2ee",
                }
                : { publicKey: `key-${suffix}`, encryptionMode: "plain" },
            select: { id: true },
        });
        const session = await db.session.create({
            data: { accountId: account.id, tag: `source-${suffix}`, encryptionMode: "plain", metadata: "{}" },
            select: { id: true },
        });
        const turnId = `turn-${suffix}`;
        await applySessionTurnMutation({
            actorUserId: account.id,
            mutation: {
                v: 1,
                sessionId: session.id,
                mutationId: `begin-${suffix}`,
                action: "begin",
                turnId,
                observedAt: Date.now() - 1_000,
                agentId: params.agentId,
                agentTurnId: params.agentTurnId,
            },
        });
        return { accountId: account.id, sessionId: session.id, turnId, suffix };
    }

    async function trigger(params: Awaited<ReturnType<typeof source>> & {
        enabled?: boolean;
        triggerEnabled?: boolean;
        deleted?: boolean;
        events?: Array<"parentTurnCompleted" | "parentTurnFailed" | "parentTurnCancelled" | "userActionRequired">;
        policy?:
            | { kind: "currentTurn"; sourceTurnId: string }
            | { kind: "firstMatch" }
            | { kind: "nextMatches"; count: number }
            | { kind: "everyMatch" };
    }) {
        const recipe = serializeAutomationStoredDefinitionExecutionRecipeV1({
            v: 1,
            templateVersion: 1,
            template: { t: "plain", v: { v: 1, prompt: "Exact turn" } },
            triggerEvidence: null,
            target: {
                kind: "newSession",
                spawn: {
                    executionTarget: { serverId: `server-${params.suffix}`, machineId: `machine-${params.suffix}` },
                    directory: "/tmp/exact-turn",
                    agentTarget: { kind: "agent", identity: { pluginId: "happier.agent.codex", localId: "codex" } },
                },
            },
        });
        if (recipe.kind !== "available") throw new Error("Recipe unavailable");
        const automation = await db.automation.create({
            data: {
                accountId: params.accountId,
                name: "Exact turn",
                enabled: params.enabled ?? true,
                targetType: "new_session",
                templateCiphertext: recipe.serialized,
                templateVersion: 1,
            },
            select: { id: true },
        });
        // Assignment-liveness: canonical admission refuses an enabled
        // Automation whose execution-assignment set is empty.
        const executionMachineId = `execution-${randomUUID()}`;
        await db.machine.create({
            data: { id: executionMachineId, accountId: params.accountId, metadata: "{}" },
        });
        await db.automationAssignment.create({
            data: {
                automationId: automation.id,
                machineId: executionMachineId,
                enabled: true,
            },
        });
        const lifecycle = encodeAutomationSessionLifecycleConfiguration({
            kind: "sessionLifecycle",
            sourceSessionId: params.sessionId,
            events: params.events ?? ["parentTurnCompleted"],
            policy: params.policy ?? { kind: "currentTurn", sourceTurnId: params.turnId },
        });
        return await db.automationTrigger.create({
            data: {
                automationId: automation.id,
                kind: "sessionLifecycle",
                revision: 1,
                ...(params.deleted
                    ? {
                        enabled: false,
                        deletedAt: new Date(),
                        sessionLifecycleEventsJson: null,
                        sessionLifecyclePolicyKind: null,
                        sessionLifecycleMatchCount: null,
                        remainingOccurrences: null,
                        sourceSessionId: null,
                        sourceTurnId: null,
                    }
                    : {
                        enabled: params.triggerEnabled ?? true,
                        deletedAt: null,
                        ...lifecycle,
                    }),
            },
            select: { id: true, automationId: true },
        });
    }

    it("creates one Run per trigger and replay creates none additional", async () => {
        const current = await source();
        const first = await trigger(current);
        const second = await trigger({ ...current, suffix: `${current.suffix}-2` });
        const completedAt = Date.now();
        await expect(applySessionTurnMutation({
            actorUserId: current.accountId,
            mutation: { v: 1, sessionId: current.sessionId, mutationId: `complete-${current.suffix}`, action: "complete", turnId: current.turnId, observedAt: completedAt },
        })).resolves.toMatchObject({ ok: true, didApply: true });
        await expect(db.automationRun.count({ where: { triggerId: { in: [first.id, second.id] } } })).resolves.toBe(2);
        await expect(applySessionTurnMutation({
            actorUserId: current.accountId,
            mutation: { v: 1, sessionId: current.sessionId, mutationId: `replay-${current.suffix}`, action: "complete", turnId: current.turnId, observedAt: completedAt + 1 },
        })).resolves.toMatchObject({ ok: true, didApply: false });
        await expect(db.automationRun.count({ where: { triggerId: { in: [first.id, second.id] } } })).resolves.toBe(2);
    });

    it("selects exact-turn candidates from the settled Session Account only", async () => {
        const current = await source();
        const foreign = await source();
        await trigger({
            ...foreign,
            sessionId: current.sessionId,
            turnId: current.turnId,
        });

        await expect(inTx(async (tx) => await admitSessionLifecycleAutomationRunsTx({
            tx,
            accountId: current.accountId,
            occurrence: {
                v: 1,
                kind: "sessionLifecycle",
                event: "parentTurnCompleted",
                sourceSessionId: current.sessionId,
                sourceTurnId: current.turnId,
                occurredAt: Date.now(),
            },
        }))).resolves.toEqual([]);
    });

    it("fans out more than the portable SQL bind ceiling of exact-turn matches in the settlement transaction", async () => {
        const current = await source();
        const matchCount = 520;
        const recipe = serializeAutomationStoredDefinitionExecutionRecipeV1({
            v: 1,
            templateVersion: 1,
            template: { t: "plain", v: { v: 1, prompt: "Exact turn fan-out" } },
            triggerEvidence: null,
            target: {
                kind: "newSession",
                spawn: {
                    executionTarget: { serverId: `server-${current.suffix}`, machineId: `machine-${current.suffix}` },
                    directory: "/tmp/exact-turn",
                    agentTarget: { kind: "agent", identity: { pluginId: "happier.agent.codex", localId: "codex" } },
                },
            },
        });
        if (recipe.kind !== "available") throw new Error("Recipe unavailable");
        const now = new Date();
        const automationRows = Array.from({ length: matchCount }, (_, index) => ({
            id: `fan-out-automation-${index}-${current.suffix}`,
            accountId: current.accountId,
            name: `Exact turn fan-out ${index}`,
            enabled: true,
            targetType: "new_session" as const,
            templateCiphertext: recipe.serialized,
            templateVersion: 1,
            updatedAt: now,
        }));
        for (const chunk of automationPortableQueryChunks({ values: automationRows, bindingsPerValue: 9 })) {
            await db.automation.createMany({ data: [...chunk] });
        }
        const lifecycle = encodeAutomationSessionLifecycleConfiguration({
            kind: "sessionLifecycle",
            sourceSessionId: current.sessionId,
            events: ["parentTurnCompleted"],
            policy: { kind: "currentTurn", sourceTurnId: current.turnId },
        });
        const triggerRows = automationRows.map((automation) => ({
            id: `fan-out-trigger-${automation.id}`,
            automationId: automation.id,
            kind: "sessionLifecycle" as const,
            enabled: true,
            ...lifecycle,
            updatedAt: now,
        }));
        for (const chunk of automationPortableQueryChunks({ values: triggerRows, bindingsPerValue: 9 })) {
            await db.automationTrigger.createMany({ data: [...chunk] });
        }
        // Assignments reference real Account machines. The production schema
        // enforces this FK, so seed the fan-out machines before inserting the
        // assignment rows used by this bind-ceiling regression.
        const fanOutMachines = automationRows.map((automation) => ({
            id: `fan-out-execution-${automation.id}`,
            accountId: current.accountId,
            metadata: "{}",
        }));
        for (const chunk of automationPortableQueryChunks({ values: fanOutMachines, bindingsPerValue: 9 })) {
            await db.machine.createMany({ data: [...chunk] });
        }
        const fanOutAssignmentRows = automationRows.map((automation) => ({
            automationId: automation.id,
            machineId: `fan-out-execution-${automation.id}`,
            enabled: true,
        }));
        for (const chunk of automationPortableQueryChunks({ values: fanOutAssignmentRows, bindingsPerValue: 9 })) {
            await db.automationAssignment.createMany({ data: [...chunk] });
        }

        await expect(applySessionTurnMutation({
            actorUserId: current.accountId,
            mutation: {
                v: 1,
                sessionId: current.sessionId,
                mutationId: `complete-fan-out-${current.suffix}`,
                action: "complete",
                turnId: current.turnId,
                observedAt: now.getTime(),
            },
        })).resolves.toMatchObject({ ok: true, didApply: true });

        await expect(db.automationRun.count({
            where: { triggerId: { in: triggerRows.map((trigger) => trigger.id) } },
        })).resolves.toBe(matchCount);
    });

    it("admits every eligible exact-turn sibling outside Event and Conversation capacity", async () => {
        const current = await source();
        const triggers = [
            await trigger(current),
            await trigger({ ...current, suffix: `${current.suffix}-2` }),
        ].sort((left, right) => left.id.localeCompare(right.id));
        const now = new Date();
        const occupiedRuns = Array.from(
            { length: MAX_NON_TERMINAL_EVENT_CONVERSATION_RUNS_PER_ACCOUNT - 1 },
            (_, index) => ({
                id: `exact-turn-capacity-${index}`,
                automationId: triggers[0]!.automationId,
                accountId: current.accountId,
                state: "queued" as const,
                causeKind: "conversation" as const,
                causeOccurredAt: now,
                occurrenceKey: `exact-turn-capacity-occurrence-${index}`,
                triggerEvidenceEnvelope: JSON.stringify({ t: "plain", v: {} }),
                executionInputEnvelope: "{}",
                replyContextEnvelope: "{}",
                replyHandoffActionPluginId: "happier.channels",
                replyHandoffActionLocalId: "automation-result-deliver-v1",
                replyHandoffTargetMachineId: "capacity-machine",
                replyHandoffTargetMachineInstallationId: "capacity-installation",
                replyHandoffTargetMaterializationId: "capacity-materialization",
                replyHandoffId: `exact-turn-capacity-handoff-${index}`,
                replyHandoffState: "awaitingResult" as const,
                scheduledAt: now,
                dueAt: now,
            }),
        );
        for (const chunk of automationPortableQueryChunks({
            values: occupiedRuns,
            bindingsPerValue: 20,
        })) {
            await db.automationRun.createMany({ data: [...chunk] });
        }

        await expect(applySessionTurnMutation({
            actorUserId: current.accountId,
            mutation: {
                v: 1,
                sessionId: current.sessionId,
                mutationId: `complete-capacity-${current.suffix}`,
                action: "complete",
                turnId: current.turnId,
                observedAt: now.getTime(),
            },
        })).resolves.toMatchObject({ ok: true, didApply: true });

        await expect(db.automationRun.findMany({
            where: { triggerId: { in: triggers.map((item) => item.id) } },
            orderBy: { triggerId: "asc" },
            select: { triggerId: true, state: true, errorCode: true, executionDispatchState: true },
        })).resolves.toEqual([
            {
                triggerId: triggers[0]!.id,
                state: "queued",
                errorCode: null,
                executionDispatchState: null,
            },
            {
                triggerId: triggers[1]!.id,
                state: "queued",
                errorCode: null,
                executionDispatchState: null,
            },
        ]);
    });

    it("rolls back settlement on Run persistence crash and admits once on retry", async () => {
        const current = await source();
        const created = await trigger(current);
        const mutation = { v: 1 as const, sessionId: current.sessionId, mutationId: `complete-${current.suffix}`, action: "complete" as const, turnId: current.turnId, observedAt: Date.now() };
        const restore = failRunCreate(created.automationId);
        try {
            await expect(applySessionTurnMutation({ actorUserId: current.accountId, mutation })).resolves.toEqual({ ok: false, error: "internal" });
        } finally { restore(); }
        await expect(db.sessionTurn.findUniqueOrThrow({
            where: { sessionId_turnId: { sessionId: current.sessionId, turnId: current.turnId } },
            select: { status: true },
        })).resolves.toEqual({ status: "in_progress" });
        await expect(db.automationRun.count({ where: { triggerId: created.id } })).resolves.toBe(0);
        await expect(applySessionTurnMutation({ actorUserId: current.accountId, mutation })).resolves.toMatchObject({ ok: true, didApply: true });
        await expect(db.automationRun.count({ where: { triggerId: created.id } })).resolves.toBe(1);
    });

    it.each(["fail", "cancel", "end_session"] as const)("%s creates no Run", async (action) => {
        const current = await source();
        const created = await trigger(current);
        const observedAt = Date.now();
        await expect(applySessionTurnMutation({
            actorUserId: current.accountId,
            mutation: {
                v: 1,
                sessionId: current.sessionId,
                mutationId: `${action}-${current.suffix}`,
                action,
                turnId: current.turnId,
                observedAt,
                ...(action === "fail" ? { issue: {
                    v: 1 as const,
                    scope: "primary_session" as const,
                    status: "failed" as const,
                    code: "opencode_prompt_submission_failed" as const,
                    source: "agent_session_error" as const,
                    occurredAt: observedAt,
                    provider: "opencode",
                    sanitizedPreview: "test",
                } } : {}),
            },
        })).resolves.toMatchObject({ ok: true, didApply: true });
        await expect(db.automationRun.count({ where: { triggerId: created.id } })).resolves.toBe(0);
        await expect(db.automationTrigger.findUniqueOrThrow({
            where: { id: created.id },
            select: { remainingOccurrences: true },
        })).resolves.toEqual({ remainingOccurrences: 0 });
    });

    it.each([
        { action: "fail" as const, event: "parentTurnFailed" as const },
        { action: "cancel" as const, event: "parentTurnCancelled" as const },
        { action: "end_session" as const, event: "parentTurnCancelled" as const },
        { action: "complete" as const, event: "parentTurnCompleted" as const },
    ])("rejoins a concurrent occurrence winner instead of failing $action settlement", async ({ action, event }) => {
        const current = await source();
        const created = await trigger({ ...current, events: [event] });
        const observedAt = Date.now();
        const injection = failFirstRunCreateWithOccurrenceConflict(created.automationId);
        try {
            await expect(applySessionTurnMutation({
                actorUserId: current.accountId,
                mutation: {
                    v: 1,
                    sessionId: current.sessionId,
                    mutationId: `${action}-occurrence-race-${current.suffix}`,
                    action,
                    turnId: current.turnId,
                    observedAt,
                    ...(action === "fail" ? { issue: {
                        v: 1 as const,
                        scope: "primary_session" as const,
                        status: "failed" as const,
                        code: "opencode_prompt_submission_failed" as const,
                        source: "agent_session_error" as const,
                        occurredAt: observedAt,
                        provider: "opencode",
                        sanitizedPreview: "test",
                    } } : {}),
                },
            })).resolves.toMatchObject({ ok: true, didApply: true });
        } finally { injection.restore(); }

        expect(injection.didInject()).toBe(true);
        await expect(db.automationRun.count({ where: { triggerId: created.id } })).resolves.toBe(1);
        await expect(db.sessionTurn.findUniqueOrThrow({
            where: { sessionId_turnId: { sessionId: current.sessionId, turnId: current.turnId } },
            select: { status: true },
        })).resolves.toEqual({
            status: action === "complete"
                ? "completed"
                : action === "fail" ? "failed" : "cancelled",
        });
    });

    it.each(["fail", "cancel", "end_session"] as const)(
        "publishes one content-free Automation invalidation when %s consumes the budget without a Run",
        async (action) => {
            const current = await source();
            const created = await trigger(current);
            const emitUpdate = vi.spyOn(eventRouter, "emitUpdate").mockImplementation(() => {});
            const observedAt = Date.now();
            try {
                await expect(applySessionTurnMutation({
                    actorUserId: current.accountId,
                    mutation: {
                        v: 1,
                        sessionId: current.sessionId,
                        mutationId: `${action}-invalidate-${current.suffix}`,
                        action,
                        turnId: current.turnId,
                        observedAt,
                        ...(action === "fail" ? { issue: {
                            v: 1 as const,
                            scope: "primary_session" as const,
                            status: "failed" as const,
                            code: "opencode_prompt_submission_failed" as const,
                            source: "agent_session_error" as const,
                            occurredAt: observedAt,
                            provider: "opencode",
                            sanitizedPreview: "test",
                        } } : {}),
                    },
                })).resolves.toMatchObject({ ok: true, didApply: true });

                await expect(db.automationTrigger.findUniqueOrThrow({
                    where: { id: created.id },
                    select: { remainingOccurrences: true },
                })).resolves.toEqual({ remainingOccurrences: 0 });
                await expect(db.automationRun.count({
                    where: { triggerId: created.id },
                })).resolves.toBe(0);

                const invalidations = emitUpdate.mock.calls.filter(([update]) => (
                    update.payload.body.t === "automation-source-status-updated"
                ));
                expect(invalidations).toHaveLength(1);
                expect(invalidations[0]?.[0]).toEqual(expect.objectContaining({
                    userId: current.accountId,
                    payload: expect.objectContaining({
                        body: { t: "automation-source-status-updated" },
                    }),
                    recipientFilter: { type: "user-scoped-only" },
                }));
            } finally { emitUpdate.mockRestore(); }

            await expect(db.accountChange.findUnique({
                where: {
                    accountId_kind_entityId: {
                        accountId: current.accountId,
                        kind: "automation",
                        entityId: created.automationId,
                    },
                },
                select: { entityId: true },
            })).resolves.toEqual({ entityId: created.automationId });
        },
    );

    it.each([
        { action: "fail" as const, event: "parentTurnFailed" as const },
        { action: "cancel" as const, event: "parentTurnCancelled" as const },
        { action: "end_session" as const, event: "parentTurnCancelled" as const },
    ])("admits the selected $event terminal occurrence", async ({ action, event }) => {
        const current = await source();
        const created = await trigger({ ...current, events: [event] });
        const observedAt = Date.now();
        await expect(applySessionTurnMutation({
            actorUserId: current.accountId,
            mutation: {
                v: 1,
                sessionId: current.sessionId,
                mutationId: `${action}-selected-${current.suffix}`,
                action,
                turnId: current.turnId,
                observedAt,
                ...(action === "fail" ? { issue: {
                    v: 1 as const,
                    scope: "primary_session" as const,
                    status: "failed" as const,
                    code: "opencode_prompt_submission_failed" as const,
                    source: "agent_session_error" as const,
                    occurredAt: observedAt,
                    provider: "opencode",
                    sanitizedPreview: "test",
                } } : {}),
            },
        })).resolves.toMatchObject({ ok: true, didApply: true });
        await expect(db.automationRun.findFirstOrThrow({
            where: { triggerId: created.id },
            select: { causeSessionLifecycleEvent: true },
        })).resolves.toEqual({ causeSessionLifecycleEvent: event });
    });

    it("shares one bounded budget across selected Events and never decrements a replay twice", async () => {
        const current = await source();
        const created = await trigger({
            ...current,
            events: ["parentTurnCompleted", "parentTurnFailed"],
            policy: { kind: "nextMatches", count: 2 },
        });
        const first = {
            v: 1 as const,
            kind: "sessionLifecycle" as const,
            event: "parentTurnCompleted" as const,
            sourceSessionId: current.sessionId,
            sourceTurnId: `${current.turnId}-1`,
            occurredAt: Date.now(),
        };
        await inTx(async (tx) => await admitSessionLifecycleAutomationRunsTx({
            tx,
            accountId: current.accountId,
            occurrence: first,
        }));
        await inTx(async (tx) => await admitSessionLifecycleAutomationRunsTx({
            tx,
            accountId: current.accountId,
            occurrence: first,
        }));
        const secondOccurrence = {
            ...first,
            event: "parentTurnFailed" as const,
            sourceTurnId: `${current.turnId}-2`,
            occurredAt: first.occurredAt + 2,
        };
        await inTx(async (tx) => await admitSessionLifecycleAutomationRunsTx({
            tx,
            accountId: current.accountId,
            occurrence: secondOccurrence,
        }));
        await expect(inTx(async (tx) => await admitSessionLifecycleAutomationRunsTx({
            tx,
            accountId: current.accountId,
            occurrence: secondOccurrence,
        }))).resolves.toMatchObject([{ triggerId: created.id, result: { kind: "rejoined" } }]);
        await inTx(async (tx) => await admitSessionLifecycleAutomationRunsTx({
            tx,
            accountId: current.accountId,
            occurrence: {
                ...first,
                sourceTurnId: `${current.turnId}-3`,
                occurredAt: first.occurredAt + 3,
            },
        }));
        await expect(db.automationRun.count({ where: { triggerId: created.id } })).resolves.toBe(2);
        await expect(db.automationTrigger.findUniqueOrThrow({
            where: { id: created.id },
            select: { remainingOccurrences: true },
        })).resolves.toEqual({ remainingOccurrences: 0 });
    });

    it("admits one content-free main-turn attention occurrence and rejects an unknown turn", async () => {
        const current = await source();
        const created = await trigger({
            ...current,
            events: ["userActionRequired"],
            policy: { kind: "firstMatch" },
        });
        const occurredAt = Date.now();
        const admitted = await inTx(async (tx) => await admitSessionLifecycleAutomationRunsTx({
            tx,
            accountId: current.accountId,
            occurrence: {
                v: 1,
                kind: "sessionLifecycle",
                event: "userActionRequired",
                sourceSessionId: current.sessionId,
                sourceTurnId: current.turnId,
                requestId: "request-1",
                requestKind: "user_action",
                occurredAt,
            },
        }));
        expect(admitted).toHaveLength(1);
        await expect(db.automationRun.findFirstOrThrow({
            where: { triggerId: created.id },
            select: {
                causeSessionLifecycleEvent: true,
                causeSessionLifecycleRequestId: true,
                causeSessionLifecycleRequestKind: true,
                causeOccurredAt: true,
            },
        })).resolves.toEqual({
            causeSessionLifecycleEvent: "userActionRequired",
            causeSessionLifecycleRequestId: "request-1",
            causeSessionLifecycleRequestKind: "user_action",
            causeOccurredAt: new Date(occurredAt),
        });

        await expect(inTx(async (tx) => await admitSessionLifecycleAutomationRunsTx({
            tx,
            accountId: current.accountId,
            occurrence: {
                v: 1,
                kind: "sessionLifecycle",
                event: "userActionRequired",
                sourceSessionId: current.sessionId,
                sourceTurnId: "unknown-turn",
                requestId: "request-2",
                requestKind: "permission",
                occurredAt: occurredAt + 1,
            },
        }))).resolves.toEqual([]);
        await expect(db.automationRun.count({ where: { triggerId: created.id } })).resolves.toBe(1);
    });

    it("never admits a main-turn attention occurrence for a superseded or terminalized turn", async () => {
        const current = await source();
        const created = await trigger({
            ...current,
            events: ["userActionRequired"],
            policy: { kind: "everyMatch" },
        });
        const attention = (sourceTurnId: string, requestId: string, occurredAt: number) => ({
            v: 1 as const,
            kind: "sessionLifecycle" as const,
            event: "userActionRequired" as const,
            sourceSessionId: current.sessionId,
            sourceTurnId,
            requestId,
            requestKind: "permission" as const,
            occurredAt,
        });
        const occurredAt = Date.now();

        // Control: the live parent turn still admits its attention occurrence.
        await expect(inTx(async (tx) => await admitSessionLifecycleAutomationRunsTx({
            tx,
            accountId: current.accountId,
            occurrence: attention(current.turnId, "request-live", occurredAt),
        }))).resolves.toHaveLength(1);

        // Superseded: a newer parent turn is the Session's current turn, so a
        // late publisher's occurrence for the previous turn binds to nothing.
        const supersedingTurnId = `${current.turnId}-next`;
        await expect(applySessionTurnMutation({
            actorUserId: current.accountId,
            mutation: {
                v: 1,
                sessionId: current.sessionId,
                mutationId: `begin-next-${current.suffix}`,
                action: "begin",
                turnId: supersedingTurnId,
                observedAt: occurredAt + 1,
            },
        })).resolves.toMatchObject({ ok: true, didApply: true });
        await expect(db.sessionTurn.findFirstOrThrow({
            where: { sessionId: current.sessionId, turnId: current.turnId },
            select: { status: true },
        })).resolves.toEqual({ status: "in_progress" });
        await expect(inTx(async (tx) => await admitSessionLifecycleAutomationRunsTx({
            tx,
            accountId: current.accountId,
            occurrence: attention(current.turnId, "request-superseded", occurredAt + 2),
        }))).resolves.toEqual([]);

        // Terminalized: the exact turn is the Session's current turn but has
        // already settled, so its pending request cannot still be awaiting a user.
        await expect(applySessionTurnMutation({
            actorUserId: current.accountId,
            mutation: {
                v: 1,
                sessionId: current.sessionId,
                mutationId: `complete-next-${current.suffix}`,
                action: "complete",
                turnId: supersedingTurnId,
                observedAt: occurredAt + 3,
            },
        })).resolves.toMatchObject({ ok: true, didApply: true });
        await expect(inTx(async (tx) => await admitSessionLifecycleAutomationRunsTx({
            tx,
            accountId: current.accountId,
            occurrence: attention(supersedingTurnId, "request-terminal", occurredAt + 4),
        }))).resolves.toEqual([]);

        await expect(db.automationRun.count({ where: { triggerId: created.id } })).resolves.toBe(1);
    });

    it("keeps a failed exact turn terminal and never admits it", async () => {
        const current = await source();
        const created = await trigger(current);
        const failedAt = Date.now();
        await expect(applySessionTurnMutation({
            actorUserId: current.accountId,
            mutation: {
                v: 1,
                sessionId: current.sessionId,
                mutationId: `fail-${current.suffix}`,
                action: "fail",
                turnId: current.turnId,
                observedAt: failedAt,
                issue: {
                    v: 1,
                    scope: "primary_session",
                    status: "failed",
                    code: "opencode_prompt_submission_failed",
                    source: "agent_session_error",
                    occurredAt: failedAt,
                    provider: "opencode",
                    sanitizedPreview: "test",
                },
            },
        })).resolves.toMatchObject({ ok: true, didApply: true });

        await expect(applySessionTurnMutation({
            actorUserId: current.accountId,
            mutation: {
                v: 1,
                sessionId: current.sessionId,
                mutationId: `recover-begin-${current.suffix}`,
                action: "begin",
                turnId: current.turnId,
                observedAt: failedAt + 1,
            },
        })).resolves.toMatchObject({ ok: true, didApply: false });
        await expect(applySessionTurnMutation({
            actorUserId: current.accountId,
            mutation: {
                v: 1,
                sessionId: current.sessionId,
                mutationId: `recover-complete-${current.suffix}`,
                action: "complete",
                turnId: current.turnId,
                observedAt: failedAt + 2,
            },
        })).resolves.toMatchObject({ ok: true, didApply: false });
        await expect(db.automationRun.count({ where: { triggerId: created.id } })).resolves.toBe(0);
    });

    it.each([
        { action: "fail" as const },
        { action: "cancel" as const },
        { action: "end_session" as const },
    ])("fails closed before settling a $action turn for a non-current Account", async ({ action }) => {
        const current = await source({ inconsistentE2ee: true });
        const created = await trigger({
            ...current,
            events: ["parentTurnCompleted", "parentTurnFailed", "parentTurnCancelled"],
        });
        const observedAt = Date.now();
        const base = {
            v: 1 as const,
            sessionId: current.sessionId,
            mutationId: `${action}-${current.suffix}`,
            turnId: current.turnId,
            observedAt,
        };
        await expect(applySessionTurnMutation({
            actorUserId: current.accountId,
            mutation: action === "fail"
                ? {
                    ...base,
                    action,
                    issue: {
                        v: 1,
                        scope: "primary_session",
                        status: "failed",
                        code: "opencode_prompt_submission_failed",
                        source: "agent_session_error",
                        occurredAt: observedAt,
                        provider: "opencode",
                        sanitizedPreview: "test",
                    },
                }
                : { ...base, action },
        })).resolves.toEqual({ ok: false, error: "internal" });

        // Terminal settlement is the exact-turn admission transaction, so it
        // must not commit the turn without its eligible Run.
        await expect(db.automationRun.count({ where: { triggerId: created.id } })).resolves.toBe(0);
        await expect(db.sessionTurn.findFirstOrThrow({
            where: { sessionId: current.sessionId, turnId: current.turnId },
            select: { status: true },
        })).resolves.toEqual({ status: "in_progress" });
    });

    it("fails closed before settling a main-turn attention occurrence for a non-current Account", async () => {
        const current = await source({ inconsistentE2ee: true });
        const created = await trigger({
            ...current,
            events: ["userActionRequired"],
        });
        const session = await db.session.findUniqueOrThrow({
            where: { id: current.sessionId },
            select: { agentStateVersion: true },
        });

        await expect(updateSessionAgentState({
            actorUserId: current.accountId,
            sessionId: current.sessionId,
            expectedVersion: session.agentStateVersion,
            agentStateCiphertext: "{}",
            userActionRequiredOccurrences: [{
                requestId: "request-non-current-account",
                sourceTurnId: current.turnId,
                requestKind: "permission",
                occurredAt: Date.now(),
            }],
        })).resolves.toEqual({ ok: false, error: "internal" });

        await expect(db.automationRun.count({ where: { triggerId: created.id } })).resolves.toBe(0);
        await expect(db.session.findUniqueOrThrow({
            where: { id: current.sessionId },
            select: { agentStateVersion: true },
        })).resolves.toEqual({ agentStateVersion: session.agentStateVersion });
    });

    it("keeps an exact-turn trigger inert when its selected occurrence cannot admit a Run", async () => {
        const current = await source();
        const created = await trigger(current);
        // Removing every execution assignment makes admission permanently
        // ineligible for this occurrence without changing the occurrence.
        await db.automationAssignment.deleteMany({ where: { automationId: created.automationId } });
        const emitUpdate = vi.spyOn(eventRouter, "emitUpdate").mockImplementation(() => {});

        try {
            await expect(applySessionTurnMutation({
                actorUserId: current.accountId,
                mutation: {
                    v: 1,
                    sessionId: current.sessionId,
                    mutationId: `complete-${current.suffix}`,
                    action: "complete",
                    turnId: current.turnId,
                    observedAt: Date.now(),
                },
            })).resolves.toMatchObject({ ok: true, didApply: true });

            await expect(db.automationRun.count({ where: { triggerId: created.id } })).resolves.toBe(0);
            await expect(db.automationTrigger.findUniqueOrThrow({
                where: { id: created.id },
                select: { remainingOccurrences: true },
            })).resolves.toEqual({ remainingOccurrences: 0 });
            // The consumed budget changed the projected trigger status without
            // producing a Run, so the canonical invalidation still fires.
            expect(emitUpdate.mock.calls.filter(([update]) => (
                update.payload.body.t === "automation-source-status-updated"
            ))).toHaveLength(1);
        } finally { emitUpdate.mockRestore(); }
    });

    it.each([
        { enabled: false, triggerEnabled: true, deleted: false },
        { enabled: true, triggerEnabled: false, deleted: false },
        { enabled: true, triggerEnabled: true, deleted: true },
    ])("never backfills membership missed at terminal commit", async (state) => {
        const current = await source();
        const created = await trigger({ ...current, ...state });
        const observedAt = Date.now();
        await applySessionTurnMutation({
            actorUserId: current.accountId,
            mutation: { v: 1, sessionId: current.sessionId, mutationId: `complete-${current.suffix}`, action: "complete", turnId: current.turnId, observedAt },
        });
        await db.automation.update({ where: { id: created.automationId }, data: { enabled: true } });
        if (!state.deleted) {
            await db.automationTrigger.update({ where: { id: created.id }, data: { enabled: true } });
        }
        await applySessionTurnMutation({
            actorUserId: current.accountId,
            mutation: { v: 1, sessionId: current.sessionId, mutationId: `replay-${current.suffix}`, action: "complete", turnId: current.turnId, observedAt: observedAt + 1 },
        });
        await expect(db.automationRun.count({ where: { triggerId: created.id } })).resolves.toBe(0);
    });
});

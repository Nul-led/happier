import type { AutomationSessionLifecycleTriggerStatus } from "@happier-dev/protocol";

import { db } from "@/storage/db";
import type { Tx } from "@/storage/inTx";

import { automationPortableQueryChunks } from "./automationPortableQueryChunks";
import { AUTOMATION_SESSION_LIFECYCLE_TERMINAL_NO_RUN_ACTIONS } from "./automationSessionLifecycleTerminalTruth";
import { decodeAutomationSessionLifecycleConfiguration } from "./automationSessionLifecycleConfigurationCodec";
import {
    isTerminalAutomationRunState,
    type AutomationListItem,
    type AutomationRunState,
    type AutomationTriggerItem,
} from "./automationTypes";

type SessionLifecycleTrigger = AutomationTriggerItem & Readonly<{
    kind: "sessionLifecycle";
}>;

function lifecycleTriggers(automations: readonly AutomationListItem[]) {
    return automations.flatMap((automation) => automation.triggers.flatMap((trigger) => (
        trigger.kind === "sessionLifecycle"
            ? [{
                automation,
                trigger: trigger as SessionLifecycleTrigger,
                stored: decodeAutomationSessionLifecycleConfiguration(trigger),
            }]
            : []
    )));
}

function sourceKey(sessionId: string, turnId: string): string {
    return JSON.stringify([sessionId, turnId]);
}

function admittedStatus(
    run: Readonly<{ id: string; state: AutomationRunState }>,
): AutomationSessionLifecycleTriggerStatus {
    if (isTerminalAutomationRunState(run.state)) return { state: "finished", runId: run.id };
    return run.state === "running"
        ? { state: "running", runId: run.id }
        : { state: "triggered", runId: run.id };
}

/** Batch-derived lifecycle status from the source facts, budget, and latest immutable Run. */
export async function loadAutomationSessionLifecycleStatusProjections(params: Readonly<{
    automations: readonly AutomationListItem[];
    tx?: Tx;
}>): Promise<ReadonlyMap<string, ReadonlyMap<string, AutomationSessionLifecycleTriggerStatus>>> {
    const client = params.tx ?? db;
    const candidates = lifecycleTriggers(params.automations);
    const result = new Map<string, Map<string, AutomationSessionLifecycleTriggerStatus>>();
    for (const automation of params.automations) result.set(automation.id, new Map());
    if (candidates.length === 0) return result;

    const currentTurnCandidates = candidates.filter(({ stored }) => (
        stored.definition.policy.kind === "currentTurn"
    ));
    const sourceSessionIds = [...new Set(candidates.map(({ stored }) => (
        stored.definition.sourceSessionId
    )))];
    const [sessionPages, turnPages, receiptPages, runPages] = await Promise.all([
        Promise.all(automationPortableQueryChunks({ values: sourceSessionIds, bindingsPerValue: 1 })
            .map((page) => client.session.findMany({
                where: { id: { in: [...page] } },
                select: { id: true },
            }))),
        Promise.all(automationPortableQueryChunks({ values: currentTurnCandidates, bindingsPerValue: 2 })
            .map((page) => client.sessionTurn.findMany({
                where: { OR: page.map(({ stored }) => ({
                    sessionId: stored.definition.sourceSessionId,
                    turnId: stored.definition.policy.kind === "currentTurn"
                        ? stored.definition.policy.sourceTurnId
                        : "",
                })) },
                select: { sessionId: true, turnId: true, status: true },
            }))),
        Promise.all(automationPortableQueryChunks({
            values: currentTurnCandidates,
            bindingsPerValue: 2,
            fixedBindings: 4,
        }).map((page) => client.sessionTurnMutationReceipt.findMany({
            where: {
                action: { in: [...AUTOMATION_SESSION_LIFECYCLE_TERMINAL_NO_RUN_ACTIONS] },
                decision: "applied",
                OR: page.map(({ stored }) => ({
                    sessionId: stored.definition.sourceSessionId,
                    turnId: stored.definition.policy.kind === "currentTurn"
                        ? stored.definition.policy.sourceTurnId
                        : "",
                })),
            },
            select: { id: true, sessionId: true, turnId: true, action: true },
            orderBy: [{ appliedAt: "asc" }, { id: "asc" }],
        }))),
        Promise.all(automationPortableQueryChunks({ values: candidates, bindingsPerValue: 1 })
            .map((page) => client.automationRun.findMany({
                where: {
                    causeKind: "trigger",
                    causeTriggerKind: "sessionLifecycle",
                    triggerId: { in: page.map(({ trigger }) => trigger.id) },
                },
                select: { id: true, state: true, triggerId: true },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            }))),
    ]);

    const existingSessions = new Set(sessionPages.flat().map((session) => session.id));
    const turnByKey = new Map(turnPages.flat().map((turn) => [
        sourceKey(turn.sessionId, turn.turnId),
        turn.status,
    ]));
    const latestRunByTrigger = new Map<string, (typeof runPages)[number][number]>();
    for (const run of runPages.flat()) {
        if (run.triggerId !== null && !latestRunByTrigger.has(run.triggerId)) {
            latestRunByTrigger.set(run.triggerId, run);
        }
    }
    const receiptStatusBySource = new Map<string, AutomationSessionLifecycleTriggerStatus>();
    for (const receipt of receiptPages.flat()) {
        if (receipt.turnId === null) continue;
        const status = receipt.action === "fail"
            ? { state: "sourceFailed", runId: null } as const
            : { state: "sourceCancelled", runId: null } as const;
        const key = sourceKey(receipt.sessionId, receipt.turnId);
        if (!receiptStatusBySource.has(key)) receiptStatusBySource.set(key, status);
    }

    for (const { automation, trigger, stored } of candidates) {
        const perTrigger = result.get(automation.id)!;
        const definition = stored.definition;
        const latestRun = latestRunByTrigger.get(trigger.id);
        if (latestRun && !isTerminalAutomationRunState(latestRun.state)) {
            perTrigger.set(trigger.id, admittedStatus(latestRun));
            continue;
        }
        if (!existingSessions.has(definition.sourceSessionId)) {
            perTrigger.set(trigger.id, { state: "sourceUnavailable", runId: null });
            continue;
        }
        if (definition.policy.kind === "currentTurn") {
            const key = sourceKey(definition.sourceSessionId, definition.policy.sourceTurnId);
            const receiptStatus = receiptStatusBySource.get(key);
            if (receiptStatus) {
                perTrigger.set(trigger.id, receiptStatus);
                continue;
            }
            const turnStatus = turnByKey.get(key);
            if (turnStatus === "failed") perTrigger.set(trigger.id, { state: "sourceFailed", runId: null });
            else if (turnStatus === "cancelled") perTrigger.set(trigger.id, { state: "sourceCancelled", runId: null });
            else if (turnStatus === "completed") {
                perTrigger.set(trigger.id, { state: "finished", runId: latestRun?.id ?? null });
            } else if (turnStatus === "in_progress") {
                perTrigger.set(trigger.id, !automation.enabled || !trigger.enabled
                    ? { state: "paused", runId: null }
                    : { state: "waiting", runId: null });
            } else perTrigger.set(trigger.id, { state: "sourceUnavailable", runId: null });
            continue;
        }
        if (stored.remainingOccurrences === 0) {
            perTrigger.set(trigger.id, { state: "finished", runId: latestRun?.id ?? null });
        } else if (!automation.enabled || !trigger.enabled) {
            perTrigger.set(trigger.id, { state: "paused", runId: null });
        } else {
            perTrigger.set(trigger.id, { state: "waiting", runId: null });
        }
    }
    return result;
}

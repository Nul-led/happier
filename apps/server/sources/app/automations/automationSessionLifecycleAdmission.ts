import {
    AutomationRunCauseSchema,
    AutomationSessionLifecycleOccurrenceEvidenceV1Schema,
    deriveAutomationOccurrenceKeyV1,
    snapshotAutomationSessionLifecyclePolicy,
    type AutomationSessionLifecycleOccurrenceEvidenceV1,
} from "@happier-dev/protocol";

import type { Tx } from "@/storage/inTx";

import {
    admitAutomationRunsTx,
    type AutomationRunAdmissionRequest,
    type AutomationRunAdmissionResult,
} from "./automationRunAdmissionService";
import { decodeAutomationSessionLifecycleConfiguration } from "./automationSessionLifecycleConfigurationCodec";

export type SessionLifecycleAdmissionResult = Readonly<{
    triggerId: string;
    result: AutomationRunAdmissionResult;
}>;

type SessionLifecycleOccurrence = AutomationSessionLifecycleOccurrenceEvidenceV1;

function isTerminalLifecycleEvent(event: SessionLifecycleOccurrence["event"]): boolean {
    return event !== "userActionRequired";
}

/**
 * Canonical Session lifecycle membership, bounded-consumption, and cause owner.
 * The caller composes this inside the Session fact's incumbent transaction.
 */
export async function admitSessionLifecycleAutomationRunsTx(params: Readonly<{
    tx: Tx;
    accountId: string;
    occurrence: SessionLifecycleOccurrence;
}>): Promise<ReadonlyArray<SessionLifecycleAdmissionResult>> {
    const occurrence = AutomationSessionLifecycleOccurrenceEvidenceV1Schema.parse(
        params.occurrence,
    );
    const rows = await params.tx.automationTrigger.findMany({
        where: {
            kind: "sessionLifecycle",
            sourceSessionId: occurrence.sourceSessionId,
            deletedAt: null,
            automation: {
                accountId: params.accountId,
                deletedAt: null,
            },
        },
        orderBy: { id: "asc" },
        select: {
            id: true,
            automationId: true,
            enabled: true,
            revision: true,
            sessionLifecycleEventsJson: true,
            sessionLifecyclePolicyKind: true,
            sessionLifecycleMatchCount: true,
            remainingOccurrences: true,
            sourceSessionId: true,
            sourceTurnId: true,
            automation: { select: { enabled: true } },
        },
    });

    const candidates: Array<{
        row: typeof rows[number];
        definition: ReturnType<typeof decodeAutomationSessionLifecycleConfiguration>["definition"];
        reserved: boolean;
    }> = [];
    for (const row of rows) {
        const stored = decodeAutomationSessionLifecycleConfiguration(row);
        const definition = stored.definition;
        const isCurrentTurn = definition.policy.kind === "currentTurn";
        if (isCurrentTurn && definition.policy.sourceTurnId !== occurrence.sourceTurnId) continue;

        const selected = definition.events.includes(occurrence.event);
        const enabled = row.enabled && row.automation.enabled;
        if (isCurrentTurn && isTerminalLifecycleEvent(occurrence.event) && (!selected || !enabled)) {
            await params.tx.automationTrigger.updateMany({
                where: { id: row.id, remainingOccurrences: { gt: 0 } },
                data: { remainingOccurrences: 0 },
            });
            continue;
        }
        if (!selected || !enabled || stored.remainingOccurrences === 0) continue;

        const bounded = stored.remainingOccurrences !== null;
        if (bounded) {
            const reserved = await params.tx.automationTrigger.updateMany({
                where: {
                    id: row.id,
                    revision: row.revision,
                    remainingOccurrences: stored.remainingOccurrences,
                },
                data: { remainingOccurrences: { decrement: 1 } },
            });
            if (reserved.count !== 1) continue;
        }
        candidates.push({ row, definition, reserved: bounded });
    }
    if (candidates.length === 0) return [];

    const admissions: AutomationRunAdmissionRequest[] = candidates.map(({ row, definition }) => {
        const cause = AutomationRunCauseSchema.parse({
            kind: "trigger",
            triggerId: row.id,
            triggerRevision: row.revision,
            triggerKind: "sessionLifecycle",
            occurrenceKey: deriveAutomationOccurrenceKeyV1({ triggerId: row.id, evidence: occurrence }),
            occurredAt: occurrence.occurredAt,
            evidence: {
                event: occurrence.event,
                sourceSessionId: occurrence.sourceSessionId,
                sourceTurnId: occurrence.sourceTurnId,
                ...(occurrence.event === "userActionRequired"
                    ? {
                        requestId: occurrence.requestId,
                        requestKind: occurrence.requestKind,
                    }
                    : {}),
                policy: snapshotAutomationSessionLifecyclePolicy(definition.policy),
            },
        });
        return {
            automationId: row.automationId,
            now: new Date(occurrence.occurredAt),
            cause,
        };
    });
    const results = await admitAutomationRunsTx({
        tx: params.tx,
        accountId: params.accountId,
        admissions,
    });

    for (let index = 0; index < candidates.length; index += 1) {
        if (!candidates[index]!.reserved || results[index]!.kind === "admitted") continue;
        await params.tx.automationTrigger.update({
            where: { id: candidates[index]!.row.id },
            data: { remainingOccurrences: { increment: 1 } },
        });
    }
    return candidates.map((candidate, index) => ({
        triggerId: candidate.row.id,
        result: results[index]!,
    }));
}

import {
    AutomationSessionLifecycleEventsSchema,
    AutomationSessionLifecycleTriggerSchema,
    initialAutomationSessionLifecycleRemainingOccurrences,
    type AutomationSessionLifecycleTrigger,
} from "@happier-dev/protocol";

type SessionLifecycleConfigurationRow = Readonly<{
    sessionLifecycleEventsJson: string | null;
    sessionLifecyclePolicyKind: "currentTurn" | "firstMatch" | "nextMatches" | "everyMatch" | null;
    sessionLifecycleMatchCount: number | null;
    remainingOccurrences: number | null;
    sourceSessionId: string | null;
    sourceTurnId: string | null;
}>;

export type StoredAutomationSessionLifecycleConfiguration = Readonly<{
    definition: AutomationSessionLifecycleTrigger;
    remainingOccurrences: number | null;
}>;

/** The sole physical trigger-row decoder for Session lifecycle configuration. */
export function decodeAutomationSessionLifecycleConfiguration(
    row: SessionLifecycleConfigurationRow,
): StoredAutomationSessionLifecycleConfiguration {
    const events = AutomationSessionLifecycleEventsSchema.parse(
        JSON.parse(required(row.sessionLifecycleEventsJson, "sessionLifecycleEventsJson")),
    );
    const sourceSessionId = required(row.sourceSessionId, "sourceSessionId");
    const policyKind = required(row.sessionLifecyclePolicyKind, "sessionLifecyclePolicyKind");
    const policy = policyKind === "currentTurn"
        ? { kind: policyKind, sourceTurnId: required(row.sourceTurnId, "sourceTurnId") } as const
        : policyKind === "nextMatches"
            ? { kind: policyKind, count: required(row.sessionLifecycleMatchCount, "sessionLifecycleMatchCount") } as const
            : { kind: policyKind } as const;
    const definition = AutomationSessionLifecycleTriggerSchema.parse({
        kind: "sessionLifecycle",
        sourceSessionId,
        events,
        policy,
    });
    const initial = initialAutomationSessionLifecycleRemainingOccurrences(definition.policy);
    const remaining = row.remainingOccurrences;
    if (initial === null ? remaining !== null : remaining === null || remaining > initial) {
        throw new Error("Automation Session lifecycle trigger has invalid remainingOccurrences");
    }
    return { definition, remainingOccurrences: remaining };
}

/** The sole Session lifecycle definition-to-row encoder. */
export function encodeAutomationSessionLifecycleConfiguration(
    definitionInput: AutomationSessionLifecycleTrigger,
) {
    const definition = AutomationSessionLifecycleTriggerSchema.parse(definitionInput);
    return {
        sessionLifecycleEventsJson: JSON.stringify(definition.events),
        sessionLifecyclePolicyKind: definition.policy.kind,
        sessionLifecycleMatchCount: definition.policy.kind === "nextMatches"
            ? definition.policy.count
            : null,
        remainingOccurrences: initialAutomationSessionLifecycleRemainingOccurrences(definition.policy),
        sourceSessionId: definition.sourceSessionId,
        sourceTurnId: definition.policy.kind === "currentTurn"
            ? definition.policy.sourceTurnId
            : null,
    } as const;
}

export function automationSessionLifecycleConfigurationsEqual(
    left: SessionLifecycleConfigurationRow,
    rightInput: AutomationSessionLifecycleTrigger,
): boolean {
    try {
        const leftDefinition = decodeAutomationSessionLifecycleConfiguration(left).definition;
        const right = AutomationSessionLifecycleTriggerSchema.parse(rightInput);
        return JSON.stringify(leftDefinition) === JSON.stringify(right);
    } catch {
        return false;
    }
}

function required<T>(value: T | null, field: string): T {
    if (value === null) throw new Error(`Automation Session lifecycle trigger has no ${field}`);
    return value;
}

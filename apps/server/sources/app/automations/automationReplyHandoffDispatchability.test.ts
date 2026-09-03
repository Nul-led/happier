import { describe, expect, it } from "vitest";

import {
    classifyAutomationReplyHandoffDispatchability,
    type AutomationReplyHandoffImmutableFacts,
} from "./automationReplyHandoffDispatchability";

const ACCOUNT_ID = "account-reply-handoff-dispatchability";
const OCCURRENCE_KEY = "A".repeat(43);

function envelope(content: "result" | "replyContext"): string {
    return JSON.stringify({
        t: "plain",
        v: content === "result"
            ? {
                v: 1,
                correspondence: {
                    accountId: ACCOUNT_ID,
                    automationId: "automation-1",
                    runId: "run-1",
                    handoffId: "handoff-1",
                },
                result: { v: 1, kind: "text", text: "The Automation completed." },
            }
            : {
                v: 1,
                correspondence: { automationId: "automation-1", occurrenceKey: OCCURRENCE_KEY },
                opaqueContext: { conversationId: "conversation-1", messageId: "message-1" },
            },
    });
}

function facts(
    overrides: Partial<AutomationReplyHandoffImmutableFacts> = {},
): AutomationReplyHandoffImmutableFacts {
    return {
        accountId: ACCOUNT_ID,
        occurrenceKey: OCCURRENCE_KEY,
        replyHandoffId: "handoff-1",
        replyHandoffActionPluginId: "happier.channels",
        replyHandoffActionLocalId: "automation/result-deliver-v1",
        replyHandoffTargetMachineId: "machine-1",
        replyHandoffTargetMachineInstallationId: "installation-1",
        replyHandoffTargetMaterializationId: "materialization-1",
        resultEnvelope: envelope("result"),
        replyContextEnvelope: envelope("replyContext"),
        ...overrides,
    };
}

describe("Automation reply-handoff dispatchability", () => {
    it("admits a complete frozen handoff", () => {
        expect(classifyAutomationReplyHandoffDispatchability({
            facts: facts(),
            mode: "plain",
        })).toBe("dispatchable");
    });

    it.each([
        ["a missing occurrence identity", { occurrenceKey: null }],
        ["a missing handoff identity", { replyHandoffId: null }],
        ["a missing target machine", { replyHandoffTargetMachineId: null }],
        ["a missing target materialization", { replyHandoffTargetMaterializationId: null }],
        ["a missing target Action", { replyHandoffActionLocalId: null }],
        ["an unparseable result envelope", { resultEnvelope: "{" }],
        ["an absent reply-context envelope", { replyContextEnvelope: null }],
    ] as const)(
        "classifies %s as terminally invalid rather than retryable",
        (_description, override) => {
            expect(classifyAutomationReplyHandoffDispatchability({
                facts: facts(override),
                mode: "plain",
            })).toBe("immutableHandoffInvalid");
        },
    );

    it("classifies an envelope written for the other Account mode as terminally invalid", () => {
        expect(classifyAutomationReplyHandoffDispatchability({
            facts: facts(),
            mode: "e2ee",
        })).toBe("immutableHandoffInvalid");
    });
});

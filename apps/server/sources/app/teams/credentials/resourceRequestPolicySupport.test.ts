import { describe, expect, it } from "vitest";
import type { TeamCredentialRequestPolicyModelSupportV1 } from "@happier-dev/protocol/teams";

import { normalizeTeamCredentialRequestPolicyForPersistence } from "./resourceRequestPolicySupport";

const application = {
    agentTargetKey: "agent:happier.agent.codex/codex",
    implementationIdentity: { pluginId: "happier.provider.openai", localId: "openai" },
    endpointTemplateId: "responses",
    protocol: "openai-responses" as const,
};

const supported: TeamCredentialRequestPolicyModelSupportV1 = {
    descriptor: { id: "gpt-5", name: "GPT-5", aliases: ["gpt-latest"] },
    application,
    sourceRevision: "source-1",
    allowedProtocolKinds: ["openai_responses"],
    reasoningEffort: { allowedValues: ["low", "medium"], defaultValue: "medium" },
};

describe("normalizeTeamCredentialRequestPolicyForPersistence", () => {
    it("requires every daemon-owned path for a selected canonical model", () => {
        const policy = {
            allowedProtocolKinds: ["openai_responses" as const],
            allowedModelIds: ["gpt-5"],
            reasoningEffort: { allowedValues: ["low"], defaultValue: "low" },
        };
        expect(normalizeTeamCredentialRequestPolicyForPersistence({ policy, models: [supported] }))
            .toEqual(policy);
        expect(normalizeTeamCredentialRequestPolicyForPersistence({
            policy,
            models: [
                supported,
                {
                    ...supported,
                    application: { ...application, endpointTemplateId: "alternate-responses" },
                    allowedProtocolKinds: ["anthropic_messages"],
                },
            ],
        })).toBeNull();
        expect(normalizeTeamCredentialRequestPolicyForPersistence({
            policy: { ...policy, allowedModelIds: ["missing-model"] },
            models: [supported],
        })).toBeNull();
    });

    it("rejects both unambiguous and ambiguous aliases from persistence", () => {
        expect(normalizeTeamCredentialRequestPolicyForPersistence({
            policy: {
                allowedProtocolKinds: ["openai_responses"],
                allowedModelIds: ["gpt-latest"],
                reasoningEffort: null,
            },
            models: [supported],
        })).toBeNull();
        const policy = {
            allowedProtocolKinds: ["openai_responses" as const],
            allowedModelIds: ["latest"],
            reasoningEffort: null,
        };
        expect(normalizeTeamCredentialRequestPolicyForPersistence({
            policy,
            models: [
                { ...supported, descriptor: { id: "gpt-5", name: "GPT-5", aliases: ["latest"] } },
                { ...supported, descriptor: { id: "gpt-6", name: "GPT-6", aliases: ["latest"] } },
            ],
        })).toBeNull();
    });
});

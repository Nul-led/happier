import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { createPresentUserSessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication.testkit";
import * as lifecycleAdmission from "@/app/automations/automationSessionLifecycleAdmission";
import { applySessionTurnMutation, updateSessionAgentState } from "./sessionWriteService";

describe("Host-stamped SessionTurn facts (SQLite integration)", () => {
    let harness: LightSqliteHarness;
    const authentication = createPresentUserSessionAccessAuthentication();

    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-turn-facts-", initAuth: false });
    }, 120_000);
    afterEach(() => vi.restoreAllMocks());
    afterAll(async () => { if (harness) await harness.close(); });

    it.each(["user", "agent_session", "host", "workflow"] as const)(
        "persists %s facts unchanged and exposes them to both lifecycle admissions",
        async (initiator) => {
            const suffix = randomUUID();
            const account = await db.account.create({ data: { publicKey: suffix, encryptionMode: "plain" } });
            const session = await db.session.create({ data: { accountId: account.id, tag: suffix, metadata: "{}", encryptionMode: "plain" } });
            const turnId = `turn-${suffix}`;
            const facts = { initiator, workDepth: 29,
                ...(initiator === "workflow" ? { workflowInvocation: { runId: `run-${suffix}`, invocationRecordId: `invocation-${suffix}` } } : {}) };
            const begin = { v: 1, sessionId: session.id, turnId, agentTurnId: `native-${suffix}`, action: "begin", mutationId: `begin-${suffix}`, observedAt: 100, ...facts };
            expect(await applySessionTurnMutation({ actorUserId: account.id, authentication, mutation: begin }))
                .toMatchObject({ ok: true, didApply: true });
            const stored = await db.sessionTurn.findUniqueOrThrow({ where: { sessionId_turnId: { sessionId: session.id, turnId } } });
            expect(stored).toMatchObject({ initiator, workDepth: 29 });
            expect(stored.workflowInvocationJson === null ? undefined : JSON.parse(stored.workflowInvocationJson))
                .toEqual(facts.workflowInvocation);

            expect(await applySessionTurnMutation({ actorUserId: account.id, authentication,
                mutation: { ...begin, mutationId: `rejoin-${suffix}`, observedAt: 110,
                    initiator: "user", workDepth: 0, workflowInvocation: undefined } }))
                .toMatchObject({ ok: true, didApply: true });
            expect(await db.sessionTurn.findUniqueOrThrow({ where: { id: stored.id } }))
                .toMatchObject({ initiator, workDepth: 29, workflowInvocationJson: stored.workflowInvocationJson });

            // A newer begin can reopen a failed turn only with matching native
            // context. That recovery is still not a new fact-establishment.
            expect(await applySessionTurnMutation({ actorUserId: account.id, authentication,
                mutation: { v: 1, sessionId: session.id, turnId, action: "fail", mutationId: `fail-${suffix}`, observedAt: 120,
                    issue: { v: 1, scope: "primary_session", status: "failed", code: "test_failure", source: "unknown", occurredAt: 120 } } }))
                .toMatchObject({ ok: true, didApply: true });
            expect(await applySessionTurnMutation({ actorUserId: account.id, authentication,
                mutation: { ...begin, mutationId: `recover-${suffix}`, observedAt: 130,
                    initiator: "user", workDepth: 0, workflowInvocation: undefined } }))
                .toMatchObject({ ok: true, didApply: true });
            expect(await db.sessionTurn.findUniqueOrThrow({ where: { id: stored.id } }))
                .toMatchObject({ initiator, workDepth: 29, workflowInvocationJson: stored.workflowInvocationJson });

            // Observation only: the spy calls the real admission owner, including
            // its real DB reads/writes. No internal domain behavior is replaced.
            const admission = vi.spyOn(lifecycleAdmission, "admitSessionLifecycleAutomationRunsTx");
            expect(await updateSessionAgentState({ actorUserId: account.id, sessionId: session.id,
                expectedVersion: 0, agentStateCiphertext: "{}", userActionRequiredOccurrences: [{
                    sourceTurnId: turnId, requestId: `request-${suffix}`, requestKind: "permission", occurredAt: 150,
                }] })).toMatchObject({ ok: true });
            expect(admission.mock.calls.find(([input]) => input.occurrence.event === "userActionRequired")?.[0])
                .toMatchObject({ sourceTurnFacts: facts });
            expect(await applySessionTurnMutation({ actorUserId: account.id, authentication,
                mutation: { v: 1, sessionId: session.id, turnId, action: "complete", mutationId: `complete-${suffix}`, observedAt: 200 } }))
                .toMatchObject({ ok: true, didApply: true });
            expect(admission.mock.calls.find(([input]) => input.occurrence.event === "parentTurnCompleted")?.[0])
                .toMatchObject({ sourceTurnFacts: facts });
            expect(await db.sessionTurn.findUniqueOrThrow({ where: { id: stored.id } }))
                .toMatchObject({ initiator, workDepth: 29, workflowInvocationJson: stored.workflowInvocationJson });
        },
    );
});

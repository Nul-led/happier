import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES, measureExternalActionResultResponseEnvelopeUtf8BytesV1 } from "@happier-dev/protocol";
import { serializeWorkflowStoredContentEnvelopeV1, sealWorkflowAcceptedSnapshotStoredEnvelopeV1 } from "@happier-dev/protocol/workflows";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { automationAccountCurrentnessSelect, deriveAutomationAccountCurrentnessWitness } from "@/app/automations/automationAccountCurrentness";
import * as service from "./workflowRunService";

describe("workflow Run live state", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => { harness = await createLightSqliteHarness({ tempDirPrefix: "happier-workflow-live-" }); }, 120_000);
    afterAll(async () => { await harness?.close(); });
    afterEach(async () => {
        if (!harness) return;
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.accountChange.deleteMany(), () => db.workflowRunInvocation.deleteMany(),
            () => db.automationRunAssignment.deleteMany(), () => db.automationRun.deleteMany(),
            () => db.automation.deleteMany(),
            () => db.artifactAccountGrant.deleteMany(), () => db.artifact.deleteMany(),
            () => db.machine.deleteMany(), () => db.account.deleteMany(),
        ]);
    });

    async function seed() {
        const account = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const machine = await db.machine.create({ data: { id: randomUUID(), accountId: account.id, metadata: "{}" } });
        const accountCurrentness = deriveAutomationAccountCurrentnessWitness(await db.account.findUniqueOrThrow({ where: { id: account.id }, select: automationAccountCurrentnessSelect }));
        if (!accountCurrentness) throw new Error("fixture Account currentness unavailable");
        return { accountId: account.id, machineId: machine.id, accountCurrentness };
    }

    async function admit(seeded: Awaited<ReturnType<typeof seed>>, sourceArtifactId?: string) {
        if (sourceArtifactId) {
            const source = await db.artifact.findUnique({ where: { id: sourceArtifactId }, select: { accountId: true } });
            if (!source) {
                await db.artifact.create({ data: {
                    id: sourceArtifactId, accountId: seeded.accountId,
                    // These lean Run reads never open Artifact content; only the real access owner is exercised.
                    header: Buffer.from("opaque-saved-workflow-header"), body: Buffer.from("opaque-saved-workflow-body"),
                    dataEncryptionKey: Buffer.alloc(0),
                } });
            } else if (source.accountId !== seeded.accountId) {
                await db.artifactAccountGrant.upsert({
                    where: { artifactId_accountId: { artifactId: sourceArtifactId, accountId: seeded.accountId } },
                    create: { artifactId: sourceArtifactId, accountId: seeded.accountId, accessLevel: "view", createdByAccountId: source.accountId },
                    update: {},
                });
            }
        }
        const runId = randomUUID();
        const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
            mode: "plain", binding: { v: 1, purpose: "accepted_snapshot", accountId: seeded.accountId, runId },
            acceptedSnapshot: {
                definition: { version: 1, inputs: [], defaults: { agentTarget: { kind: "agent", identity: { pluginId: "happier.agent.test", localId: "test" } } }, blocks: [{ kind: "step", id: "work", document: { text: "Work", references: [], attachments: [] }, input: [], result: { kind: "text" } }] },
                source: sourceArtifactId ? { kind: "saved", definitionId: sourceArtifactId, revision: { headerVersion: 0, bodyVersion: 0 } } : { kind: "inline" },
                inputs: {}, machineId: seeded.machineId, executionTarget: { kind: "session" },
                workspaceTarget: { project: { machineId: seeded.machineId, directory: "/repo", checkoutRootPath: "/repo" } },
                origin: { kind: "direct" }, authorization: { admittedPermissionCeiling: "default", principal: { kind: "host" } },
            },
        }));
        const input = { ...seeded, runId, origin: { kind: "direct" as const }, acceptedEnvelope, sourceArtifactId: sourceArtifactId ?? null };
        return { input, admitted: await service.admitWorkflowRun(input) };
    }

    it("freezes saved source identity at admission and in lean Run projections", async () => {
        const seeded = await seed();
        const sourceArtifactId = randomUUID();
        const { input, admitted } = await admit(seeded, sourceArtifactId);
        expect(admitted.run).toMatchObject({ sourceArtifactId, ownerAccountId: seeded.accountId });
        expect(await service.admitWorkflowRun(input)).toMatchObject({ kind: "existing", run: { sourceArtifactId } });
        await expect(service.admitWorkflowRun({ ...input, sourceArtifactId: randomUUID() })).rejects.toMatchObject({ code: "currentness_conflict" });
    });

    it("freezes the resolved Automation source once and rejoins after its trigger target changes", async () => {
        const seeded = await seed();
        const sourceArtifactId = randomUUID();
        const automation = await db.automation.create({ data: {
            accountId: seeded.accountId, name: "Saved workflow", workflowDefinitionId: sourceArtifactId,
            templateCiphertext: JSON.stringify({ t: "plain", v: {} }),
        } });
        const { input } = await admit(seeded, sourceArtifactId);
        const definitionEnvelope = JSON.stringify({ t: "plain", v: {} });
        await db.automationRun.update({ where: { id: input.runId }, data: {
            sourceArtifactId: null, originKind: "automation", automationId: automation.id,
            causeKind: "manual", causeOccurredAt: new Date(),
            claimedByMachineId: seeded.machineId, attempt: 1,
            workflowAcceptedSnapshotEnvelope: null, executionInputEnvelope: definitionEnvelope,
        } });
        const request = { ...seeded, runId: input.runId, automationId: automation.id,
            sourceArtifactId: automation.workflowDefinitionId,
            expectedAttempt: 1, expectedRevision: 0, definitionEnvelope, acceptedEnvelope: input.acceptedEnvelope };
        expect(await service.resolveAutomationWorkflowAcceptedSnapshot(request)).toMatchObject({
            disposition: "created", run: { sourceArtifactId },
        });
        await db.automation.update({ where: { id: automation.id }, data: { workflowDefinitionId: randomUUID() } });
        expect(await service.resolveAutomationWorkflowAcceptedSnapshot(request)).toMatchObject({
            disposition: "existing", run: { sourceArtifactId },
        });
        await expect(service.resolveAutomationWorkflowAcceptedSnapshot({
            ...request, sourceArtifactId: randomUUID(),
        })).rejects.toMatchObject({ code: "currentness_conflict" });
    });

    it("excludes unacknowledged origin delivery from attention and wait", async () => {
        const seeded = await seed();
        const { input } = await admit(seeded);
        await db.automationRun.update({ where: { id: input.runId }, data: { state: "succeeded", workflowCustodyState: "settled", originDeliveryAckRevision: 0 } });
        const page = await service.listWorkflowRuns({ accountId: seeded.accountId, attention: "required", pageByteLimit: 4096 });
        expect(page.runs).toEqual([]);
        await expect(service.waitWorkflowRun({ accountId: seeded.accountId, runId: input.runId, timeoutSeconds: 0 })).resolves.toMatchObject({ observation: "terminal" });
    });

    it("projects current attention on lean exact Run cards without opening invocation content", async () => {
        const seeded = await seed();
        const { input } = await admit(seeded);
        const request = { accountId: seeded.accountId, runId: input.runId, pageByteLimit: 4096 };
        expect((await service.listWorkflowRuns(request)).runs[0]).toMatchObject({ attentionRequired: false });
        await db.workflowRunInvocation.create({ data: {
            id: randomUUID(), runId: input.runId, sequence: 0n, memberOrdinal: 0n,
            lifecycle: "waiting_for_approval", contentEnvelope: "unopened-private-progress",
        } });
        expect((await service.listWorkflowRuns(request)).runs[0]).toMatchObject({ attentionRequired: true, revision: 0 });
        await db.workflowRunInvocation.updateMany({ where: { runId: input.runId }, data: { lifecycle: "completed" } });
        await db.automationRun.update({ where: { id: input.runId }, data: {
            state: "succeeded", workflowCustodyState: "settled", originDeliveryAckRevision: 0,
        } });
        expect((await service.listWorkflowRuns(request)).runs[0]).toMatchObject({ attentionRequired: false });
    });

    it("filters own workflow history and refuses cursors for another source or Account", async () => {
        const seeded = await seed();
        const stranger = await seed();
        const sourceArtifactId = randomUUID();
        const first = await admit(seeded, sourceArtifactId);
        const second = await admit(seeded, sourceArtifactId);
        await admit(seeded, randomUUID());
        await admit(stranger, sourceArtifactId);
        const request = { accountId: seeded.accountId, sourceArtifactId, limit: 1, pageByteLimit: 4096 };
        const page = await service.listWorkflowRuns(request);
        expect(page.runs).toHaveLength(1);
        expect([first.input.runId, second.input.runId]).toContain(page.runs[0].id);
        expect(page.nextCursor).toBeDefined();
        await expect(service.listWorkflowRuns({ ...request, sourceArtifactId: randomUUID(), cursor: page.nextCursor })).rejects.toMatchObject({ code: "invalid_input" });
        await expect(service.listWorkflowRuns({ ...request, accountId: stranger.accountId, cursor: page.nextCursor })).rejects.toMatchObject({ code: "invalid_input" });
        const next = await service.listWorkflowRuns({ ...request, cursor: page.nextCursor });
        expect(new Set([...page.runs, ...next.runs].map((run) => run.id))).toEqual(new Set([first.input.runId, second.input.runId]));
        expect((await service.listWorkflowRuns({ accountId: stranger.accountId, pageByteLimit: 4096 })).runs).toHaveLength(1);
    });

    it("summarizes three workflow histories with the same attention membership and byte continuation", async () => {
        // This assertion makes a missing operation an observable contract RED,
        // rather than a named-export failure before test collection.
        expect('summarizeWorkflowRuns' in service).toBe(true);
        const seeded = await seed();
        const stranger = await seed();
        const sourceArtifactIds = [randomUUID(), randomUUID(), randomUUID()];
        const records = [];
        for (const sourceArtifactId of sourceArtifactIds) {
            for (const state of ["interrupted", "succeeded", "running"] as const) {
                const { input } = await admit(seeded, sourceArtifactId);
                const createdAt: Date = new Date(Date.UTC(2026, 0, records.length + 1));
                await db.automationRun.update({ where: { id: input.runId }, data: { state, createdAt, workflowCustodyState: state === "succeeded" ? "settled" : "pending", originDeliveryAckRevision: state === "succeeded" ? 0 : null } });
                if (state === "running") {
                    await db.workflowRunInvocation.create({ data: {
                        id: randomUUID(), runId: input.runId, sequence: 0n, memberOrdinal: 0n,
                        // Unopenable DB-boundary content proves this lean read uses public lifecycle facts only.
                        lifecycle: "waiting_for_approval", contentEnvelope: "unopened-private-progress",
                    } });
                    const unchanged = await db.automationRun.findUniqueOrThrow({ where: { id: input.runId }, select: { revision: true } });
                    expect(unchanged.revision).toBe(0);
                    await expect(service.waitWorkflowRun({ accountId: seeded.accountId, runId: input.runId, timeoutSeconds: 0 })).resolves.toMatchObject({ observation: "needs_attention" });
                }
                records.push({ runId: input.runId, sourceArtifactId, state, createdAt });
            }
        }
        await admit(stranger, sourceArtifactIds[0]);
        const request = { accountId: seeded.accountId, sourceArtifactIds, recent: 2, pageByteLimit: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES };
        const result = await service.summarizeWorkflowRuns(request);
        expect(result.remainingSourceArtifactIds).toEqual([]);
        for (const summary of result.summaries) {
            const own = records.filter((row) => row.sourceArtifactId === summary.sourceArtifactId).reverse();
            expect(summary.lastRun).toMatchObject({ runId: own[0].runId, state: own[0].state });
            expect(summary.recent).toEqual(own.slice(0, 2).map(({ runId, state }) => ({ runId, state })));
            const attention = await service.listWorkflowRuns({ accountId: seeded.accountId, sourceArtifactId: summary.sourceArtifactId, attention: "required", pageByteLimit: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES });
            expect(summary.needsYouCount).toBe(attention.runs.length);
            expect(summary.needsYouCount).toBe(2);
            expect(summary.needsYouRunId).toBe(attention.runs[0]?.id ?? null);
        }
        const byteLimit = measureExternalActionResultResponseEnvelopeUtf8BytesV1({ summaries: [result.summaries[0]], remainingSourceArtifactIds: sourceArtifactIds.slice(1) });
        const first = await service.summarizeWorkflowRuns({ ...request, pageByteLimit: byteLimit });
        expect(first.summaries).toHaveLength(1);
        expect(first.remainingSourceArtifactIds).toEqual(sourceArtifactIds.slice(1));
        expect(measureExternalActionResultResponseEnvelopeUtf8BytesV1(first)).toBeLessThanOrEqual(byteLimit);
        const rest = await service.summarizeWorkflowRuns({ ...request, sourceArtifactIds: first.remainingSourceArtifactIds });
        expect([...first.summaries, ...rest.summaries]).toEqual(result.summaries);
        const empty = await service.summarizeWorkflowRuns({ ...request, accountId: stranger.accountId, sourceArtifactIds: [sourceArtifactIds[1]] });
        expect(empty.summaries).toEqual([{ sourceArtifactId: sourceArtifactIds[1], lastRun: null, recent: [], needsYouCount: 0, needsYouRunId: null }]);
        // The first actionable Run may be older than the entire recent strip.
        // Settling the newest child row must not make that history invisible.
        await db.workflowRunInvocation.updateMany({ data: { lifecycle: "completed" } });
        const olderAttention = await service.summarizeWorkflowRuns(request);
        for (const summary of olderAttention.summaries) {
            const interrupted = records.find((row) => row.sourceArtifactId === summary.sourceArtifactId && row.state === "interrupted");
            expect(summary.needsYouCount).toBe(1);
            expect(summary.needsYouRunId).toBe(interrupted?.runId);
            expect(summary.recent.map((run) => run.runId)).not.toContain(summary.needsYouRunId);
        }
    });
});

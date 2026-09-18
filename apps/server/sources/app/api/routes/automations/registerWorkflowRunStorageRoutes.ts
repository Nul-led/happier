import { z } from "zod";
import { AutomationAccountCurrentnessWitnessV1Schema, EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES } from "@happier-dev/protocol";
import {
    WorkflowInvocationLifecycleV1Schema,
    WorkflowRunListRequestV1Schema,
    WorkflowRunOriginV1Schema,
    WorkflowRunStateV1Schema,
} from "@happier-dev/protocol/workflows";

import {
    admitWorkflowRun,
    admitWorkflowInvocations,
    commitWorkflowInvocationFact,
    deleteWorkflowRun,
    getWorkflowRun,
    getWorkflowRunInvocation,
    initializeWorkflowRunExecution,
    listWorkflowRunInvocations,
    listWorkflowRunsForRecovery,
    listWorkflowRuns,
    pauseWorkflowRun,
    resumeWorkflowRunBoundary,
    cancelWorkflowRun,
    waitWorkflowRun,
    retryWorkflowInvocation,
    recoverWorkflowInvocations,
    resolveAutomationWorkflowAcceptedSnapshot,
    settleWorkflowRunResultDelivery,
    transitionWorkflowRun,
    WorkflowRunServiceError,
} from "@/app/workflows/workflowRunService";
import { WorkflowStoredContentError } from "@/app/workflows/runs/storedContent";

import type { Fastify } from "../../types";
import {
    DEFAULT_AUTOMATION_WORKER_PUBLISHER_DEPENDENCIES,
    resolveExactAutomationWorkerPublisher,
    type AutomationWorkerPublisherDependencies,
} from "./automationWorkerPublisher";

const PATH = "/v3/automations/runs/workflow-storage";
const PageByteLimitSchema = z.number().int().positive().max(EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES).safe();
const ResultDeliverySettleOperationSchema = z.object({
    operation: z.literal("result-delivery.settle"),
    publisherMachineId: z.string().min(1),
    runId: z.string().min(1),
    parentAttempt: z.number().int().nonnegative().safe(),
    expectedRevision: z.number().int().nonnegative(),
    state: z.enum(["accepted", "unavailable"]),
    reason: z.literal("workflow_outcome_unresolved").optional(),
}).strict().superRefine((value, context) => {
    if (value.state === "accepted" && value.reason !== undefined) {
        context.addIssue({
            code: "custom",
            path: ["reason"],
            message: "Accepted result delivery cannot carry an unavailable reason",
        });
    }
});

const OperationSchema = z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("admit"), publisherMachineId: z.string().min(1), runId: z.string().min(1), origin: WorkflowRunOriginV1Schema, machineId: z.string().min(1), accountCurrentness: AutomationAccountCurrentnessWitnessV1Schema, acceptedEnvelope: z.string().min(1), resultDelivery: z.object({ kind: z.literal("originating_session") }).strict().optional() }).strict(),
    z.object({ operation: z.literal("initialize"), publisherMachineId: z.string().min(1), runId: z.string().min(1), parentAttempt: z.number().int().nonnegative().safe(), expectedRevision: z.number().int().nonnegative(), accountCurrentness: AutomationAccountCurrentnessWitnessV1Schema, checkpointEnvelope: z.string().min(1), rootInvocation: z.object({ id: z.string().min(1), contentEnvelope: z.string().min(1) }).strict() }).strict(),
    z.object({ operation: z.literal("accepted-snapshot.resolve"), publisherMachineId: z.string().min(1), runId: z.string().min(1), automationId: z.string().min(1), expectedAttempt: z.number().int().nonnegative(), expectedRevision: z.number().int().nonnegative(), accountCurrentness: AutomationAccountCurrentnessWitnessV1Schema, definitionEnvelope: z.string().min(1), acceptedEnvelope: z.string().min(1) }).strict(),
    z.object({ operation: z.literal("get"), publisherMachineId: z.string().min(1), runId: z.string().min(1) }).strict(),
    z.object({ operation: z.literal("wait"), publisherMachineId: z.string().min(1), runId: z.string().min(1), timeoutSeconds: z.number().positive().safe().optional(), afterRevision: z.number().int().nonnegative().safe().optional() }).strict(),
    z.object({ operation: z.enum(["pause", "resume", "cancel"]), publisherMachineId: z.string().min(1), runId: z.string().min(1), expectedRevision: z.number().int().nonnegative() }).strict(),
    z.object({ operation: z.literal("list"), publisherMachineId: z.string().min(1), request: WorkflowRunListRequestV1Schema, pageByteLimit: PageByteLimitSchema }).strict(),
    z.object({ operation: z.literal("recovery.list"), publisherMachineId: z.string().min(1), cursor: z.string().optional(), limit: z.number().int().positive().safe().optional(), pageByteLimit: PageByteLimitSchema }).strict(),
    z.object({ operation: z.literal("invocations.list"), publisherMachineId: z.string().min(1), runId: z.string().min(1), cursor: z.string().optional(), limit: z.number().int().positive().optional(), parentRecordId: z.string().optional(), lifecycles: z.array(WorkflowInvocationLifecycleV1Schema).min(1).optional(), pageByteLimit: PageByteLimitSchema }).strict(),
    z.object({ operation: z.literal("invocations.admit"), publisherMachineId: z.string().min(1), runId: z.string().min(1), parentAttempt: z.number().int().nonnegative().safe(), expectedRevision: z.number().int().nonnegative(), accountCurrentness: AutomationAccountCurrentnessWitnessV1Schema, checkpointEnvelope: z.string().min(1), invocations: z.array(z.object({ id: z.string().uuid(), sequence: z.string().regex(/^(0|[1-9][0-9]*)$/), parentRecordId: z.string().min(1), memberOrdinal: z.string().regex(/^(0|[1-9][0-9]*)$/), lifecycle: z.enum(["pending", "waiting_for_capacity"]).optional(), contentEnvelope: z.string().min(1) }).strict()).min(1) }).strict(),
    z.object({ operation: z.literal("invocations.get"), publisherMachineId: z.string().min(1), runId: z.string().min(1), invocationId: z.string().min(1) }).strict(),
    z.object({ operation: z.literal("invocations.fact"), publisherMachineId: z.string().min(1), runId: z.string().min(1), parentAttempt: z.number().int().nonnegative(), accountCurrentness: AutomationAccountCurrentnessWitnessV1Schema, invocationId: z.string().min(1), invocationAttempt: z.string().regex(/^(0|[1-9][0-9]*)$/), expectedLifecycle: WorkflowInvocationLifecycleV1Schema, lifecycle: WorkflowInvocationLifecycleV1Schema, contentEnvelope: z.string().min(1), resolution: z.literal("observed_terminal_execution").optional() }).strict(),
    z.object({ operation: z.literal("transition"), publisherMachineId: z.string().min(1), runId: z.string().min(1), parentAttempt: z.number().int().nonnegative().safe(), expectedRevision: z.number().int().nonnegative(), accountCurrentness: AutomationAccountCurrentnessWitnessV1Schema, state: WorkflowRunStateV1Schema, checkpointEnvelope: z.string().min(1), resultEnvelope: z.string().nullable().optional(), custodyState: z.enum(["pending", "settled"]).optional(), invocationTransitions: z.array(z.object({ id: z.string().min(1), expectedLifecycle: WorkflowInvocationLifecycleV1Schema, lifecycle: WorkflowInvocationLifecycleV1Schema }).strict()).optional() }).strict(),
    z.object({ operation: z.literal("invocations.retry"), publisherMachineId: z.string().min(1), runId: z.string().min(1), expectedRevision: z.number().int().nonnegative(), accountCurrentness: AutomationAccountCurrentnessWitnessV1Schema, invocationId: z.string().min(1), newInvocationId: z.string().uuid(), checkpointEnvelope: z.string().min(1), contentEnvelope: z.string().min(1) }).strict(),
    z.object({ operation: z.literal("invocations.recover"), publisherMachineId: z.string().min(1), runId: z.string().min(1), expectedRevision: z.number().int().nonnegative(), accountCurrentness: AutomationAccountCurrentnessWitnessV1Schema, checkpointEnvelope: z.string().min(1), recoveries: z.array(z.object({ invocationId: z.string().min(1), newInvocationId: z.string().uuid(), contentEnvelope: z.string().min(1) }).strict()).min(1) }).strict(),
    ResultDeliverySettleOperationSchema,
    z.object({ operation: z.literal("delete"), publisherMachineId: z.string().min(1), runId: z.string().min(1), expectedRevision: z.number().int().nonnegative() }).strict(),
]);

export function registerWorkflowRunStorageRoutes(
    app: Fastify,
    dependencies: AutomationWorkerPublisherDependencies = DEFAULT_AUTOMATION_WORKER_PUBLISHER_DEPENDENCIES,
): void {
    app.post(PATH, { preHandler: app.authenticate, schema: { body: OperationSchema } }, async (request, reply) => {
        const body = request.body;
        if (!await resolveExactAutomationWorkerPublisher({
            dependencies,
            accountId: request.userId,
            request,
            path: PATH,
            machineId: body.publisherMachineId,
            allowReleasedV2MissingProof: false,
        })) return reply.code(401).send(null);
        try {
            switch (body.operation) {
                case "admit": return await admitWorkflowRun({ accountId: request.userId, runId: body.runId, origin: body.origin, machineId: body.machineId, accountCurrentness: body.accountCurrentness, acceptedEnvelope: body.acceptedEnvelope, ...(body.resultDelivery ? { resultDelivery: body.resultDelivery } : {}) });
                case "initialize": return await initializeWorkflowRunExecution({ accountId: request.userId, runId: body.runId, machineId: body.publisherMachineId, parentAttempt: body.parentAttempt, expectedRevision: body.expectedRevision, accountCurrentness: body.accountCurrentness, checkpointEnvelope: body.checkpointEnvelope, rootInvocation: body.rootInvocation });
                case "accepted-snapshot.resolve": return await resolveAutomationWorkflowAcceptedSnapshot({ accountId: request.userId, runId: body.runId, automationId: body.automationId, machineId: body.publisherMachineId, expectedAttempt: body.expectedAttempt, expectedRevision: body.expectedRevision, accountCurrentness: body.accountCurrentness, definitionEnvelope: body.definitionEnvelope, acceptedEnvelope: body.acceptedEnvelope });
                case "get": return await getWorkflowRun({ accountId: request.userId, runId: body.runId });
                case "wait": {
                    const controller = new AbortController();
                    const abort = () => controller.abort(new Error("workflow_wait_caller_aborted"));
                    request.raw.once("aborted", abort);
                    reply.raw.once("close", abort);
                    try {
                        return await waitWorkflowRun({
                            accountId: request.userId,
                            runId: body.runId,
                            ...(body.timeoutSeconds === undefined ? {} : { timeoutSeconds: body.timeoutSeconds }),
                            ...(body.afterRevision === undefined ? {} : { afterRevision: body.afterRevision }),
                            signal: controller.signal,
                        });
                    } finally {
                        request.raw.off("aborted", abort);
                        reply.raw.off("close", abort);
                    }
                }
                case "pause": return await pauseWorkflowRun({ accountId: request.userId, runId: body.runId, expectedRevision: body.expectedRevision });
                case "resume": return await resumeWorkflowRunBoundary({ accountId: request.userId, runId: body.runId, expectedRevision: body.expectedRevision });
                case "cancel": return await cancelWorkflowRun({ accountId: request.userId, runId: body.runId, expectedRevision: body.expectedRevision });
                case "list": return await listWorkflowRuns({ accountId: request.userId, ...body.request, pageByteLimit: body.pageByteLimit });
                case "recovery.list": return await listWorkflowRunsForRecovery({ accountId: request.userId, machineId: body.publisherMachineId, ...(body.cursor ? { cursor: body.cursor } : {}), ...(body.limit ? { limit: body.limit } : {}), pageByteLimit: body.pageByteLimit });
                case "invocations.list": return await listWorkflowRunInvocations({ accountId: request.userId, runId: body.runId, ...(body.cursor ? { cursor: body.cursor } : {}), ...(body.limit ? { limit: body.limit } : {}), ...(body.parentRecordId ? { parentRecordId: body.parentRecordId } : {}), ...(body.lifecycles ? { lifecycles: body.lifecycles } : {}), pageByteLimit: body.pageByteLimit });
                case "invocations.admit": return await admitWorkflowInvocations({ accountId: request.userId, runId: body.runId, machineId: body.publisherMachineId, parentAttempt: body.parentAttempt, expectedRevision: body.expectedRevision, accountCurrentness: body.accountCurrentness, checkpointEnvelope: body.checkpointEnvelope, invocations: body.invocations.map((item) => ({ id: item.id, sequence: BigInt(item.sequence), parentRecordId: item.parentRecordId, memberOrdinal: BigInt(item.memberOrdinal), ...(item.lifecycle ? { lifecycle: item.lifecycle } : {}), contentEnvelope: item.contentEnvelope })) });
                case "invocations.get": return await getWorkflowRunInvocation({ accountId: request.userId, runId: body.runId, invocationId: body.invocationId });
                case "invocations.fact": return await commitWorkflowInvocationFact({ accountId: request.userId, runId: body.runId, machineId: body.publisherMachineId, parentAttempt: body.parentAttempt, accountCurrentness: body.accountCurrentness, invocationId: body.invocationId, invocationAttempt: BigInt(body.invocationAttempt), expectedLifecycle: body.expectedLifecycle, lifecycle: body.lifecycle, contentEnvelope: body.contentEnvelope, ...(body.resolution ? { resolution: body.resolution } : {}) });
                case "transition": return await transitionWorkflowRun({ accountId: request.userId, runId: body.runId, machineId: body.publisherMachineId, parentAttempt: body.parentAttempt, expectedRevision: body.expectedRevision, accountCurrentness: body.accountCurrentness, state: body.state, checkpointEnvelope: body.checkpointEnvelope, ...(body.resultEnvelope !== undefined ? { resultEnvelope: body.resultEnvelope } : {}), ...(body.custodyState ? { custodyState: body.custodyState } : {}), ...(body.invocationTransitions ? { invocationTransitions: body.invocationTransitions } : {}) });
                case "invocations.retry": return await retryWorkflowInvocation({ accountId: request.userId, runId: body.runId, expectedRevision: body.expectedRevision, accountCurrentness: body.accountCurrentness, invocationId: body.invocationId, newInvocationId: body.newInvocationId, checkpointEnvelope: body.checkpointEnvelope, contentEnvelope: body.contentEnvelope });
                case "invocations.recover": return await recoverWorkflowInvocations({ accountId: request.userId, runId: body.runId, expectedRevision: body.expectedRevision, accountCurrentness: body.accountCurrentness, checkpointEnvelope: body.checkpointEnvelope, recoveries: body.recoveries.map((item) => ({ invocationId: item.invocationId, newInvocationId: item.newInvocationId, contentEnvelope: item.contentEnvelope })) });
                case "result-delivery.settle": return await settleWorkflowRunResultDelivery({ accountId: request.userId, runId: body.runId, machineId: body.publisherMachineId, parentAttempt: body.parentAttempt, expectedRevision: body.expectedRevision, state: body.state, ...(body.state === "unavailable" && body.reason ? { reason: body.reason } : {}) });
                case "delete": return await deleteWorkflowRun({ accountId: request.userId, runId: body.runId, expectedRevision: body.expectedRevision });
            }
        } catch (error) {
            if (error instanceof WorkflowStoredContentError) return reply.code(422).send({ error: error.code });
            if (!(error instanceof WorkflowRunServiceError)) throw error;
            const status = error.code === "run_not_found" ? 404 : error.code === "currentness_conflict" ? 409 : 422;
            return reply.code(status).send({ error: error.code });
        }
    });
}

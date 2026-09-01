import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
    MAX_NON_TERMINAL_EVENT_CONVERSATION_RUNS_PER_ACCOUNT,
    AutomationRunCauseSchema,
    AutomationRunExecutionInputV1Schema,
    createCanonicalJsonSigningInput,
    deriveAutomationManualOccurrenceKeyV1,
    normalizeAutomationTemplateEnvelopeStoredRead,
    parseAutomationStoredDefinitionExecutionRecipeV1,
    serializeAutomationRunExecutionRecipeV1,
    toAutomationRunExecutionInputV1Origin,
    type AutomationRunCause,
} from "@happier-dev/protocol";

import { afterTx, type Tx } from "@/storage/inTx";
import { markAccountChanged } from "@/app/changes/markAccountChanged";
import { classifyMachineAvailabilityState } from "@/app/machines/machineStateGuards";

import { automationRunItemSelect } from "./automationPersistenceSelect";
import { automationPortableQueryChunks } from "./automationPortableQueryChunks";
import {
    decodeAutomationRunCause,
    encodeAutomationRunCause,
    retainedV2OriginKindForRun,
} from "./automationRunCauseCodec";
import {
    AUTOMATION_RUN_TERMINAL_STATES,
    initialAutomationExecutionDispatchStateForRun,
    type AutomationRunItem,
} from "./automationTypes";
import {
    emitAutomationRunTransition,
    emitAutomationRunUpdatedToMachineOnly,
} from "./automationChangePublisher";

export type AutomationRunAdmissionIneligibleReason =
    | "automationNotFound"
    | "automationDisabled"
    | "noEnabledAssignment"
    | "triggerNotFound"
    | "triggerDisabled"
    | "triggerRevisionMismatch"
    | "triggerKindMismatch"
    | "capacity"
    | "idempotencyKeyInvalid"
    | "definitionInvalid";

export type AutomationRunAdmissionResult =
    | Readonly<{ kind: "admitted"; run: AutomationRunItem }>
    | Readonly<{ kind: "rejoined"; run: AutomationRunItem }>
    | Readonly<{ kind: "ineligible"; reason: AutomationRunAdmissionIneligibleReason }>;

export type AutomationRunReplyHandoffAdmission = Readonly<{
    contextEnvelope: string;
    actionPluginId: string;
    actionLocalId: string;
    targetMachineId: string;
    targetMachineInstallationId: string;
    targetMaterializationId: string;
}>;

function replyHandoffIdForRun(runId: string): string {
    return `automation-reply-handoff:${runId}`;
}

function sameOccurrenceCause(left: AutomationRunCause, right: AutomationRunCause): boolean {
    // A manual idempotency key identifies the invocation. Retry wall-clock
    // time is not a second immutable fact and must not make that retry collide.
    if (left.kind === "manual" && right.kind === "manual") return true;
    const withoutMutableRevision = (cause: AutomationRunCause): unknown => {
        if (cause.kind !== "trigger") return cause;
        const { triggerRevision: _mutableRevision, ...immutableOccurrence } = cause;
        return immutableOccurrence;
    };
    return createCanonicalJsonSigningInput(withoutMutableRevision(left))
        === createCanonicalJsonSigningInput(withoutMutableRevision(right));
}

export type AutomationRunAdmissionRequest = Readonly<{
    automationId: string;
    now: Date;
    cause: AutomationRunCause;
    triggerEvidenceEnvelope?: string | null;
    executionTriggerEvidenceEnvelope?: string | null;
    occurrenceEvidenceEqualityTag?: string | null;
    /** Current V3 manual retry identity, projected to the canonical occurrence key. */
    manualIdempotencyKey?: string;
    /** Released-V2-only predecessor retry column; never dual-written with V3. */
    legacyV2ManualIdempotencyKey?: string;
    replyHandoff?: AutomationRunReplyHandoffAdmission;
}>;

function parseTriggerEvidenceEnvelope(raw: string | null | undefined): unknown | null {
    if (raw === null || raw === undefined) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
}

function targetTypeForRecipe(recipe: Readonly<{ target: Readonly<{ kind: string }> }>) {
    if (recipe.target.kind === "newSession") return "new_session" as const;
    if (recipe.target.kind === "existingSession") return "existing_session" as const;
    return "execution_run" as const;
}

function occurrenceDiscriminator(params: Readonly<{
    automationId: string;
    cause: AutomationRunCause;
    manualIdempotencyKey?: string;
    legacyV2ManualIdempotencyKey?: string;
}>): Prisma.AutomationRunWhereInput | null {
    return params.cause.kind === "trigger"
        ? { triggerId: params.cause.triggerId, occurrenceKey: params.cause.occurrenceKey }
        : params.cause.kind === "conversation"
            ? {
                automationId: params.automationId,
                causeKind: "conversation",
                occurrenceKey: params.cause.occurrenceKey,
            }
            : params.manualIdempotencyKey
                ? {
                    automationId: params.automationId,
                    causeKind: "manual",
                    occurrenceKey: deriveAutomationManualOccurrenceKeyV1({
                        automationId: params.automationId,
                        idempotencyKey: params.manualIdempotencyKey,
                    }),
                }
                : params.legacyV2ManualIdempotencyKey
                    ? {
                        automationId: params.automationId,
                        causeKind: "manual",
                        legacyManualIdempotencyKey: params.legacyV2ManualIdempotencyKey,
                    }
                : null;
}

function findExistingRun(params: Readonly<{
    rows: readonly AutomationRunItem[];
    automationId: string;
    cause: AutomationRunCause;
    manualIdempotencyKey?: string;
    legacyV2ManualIdempotencyKey?: string;
    occurrenceEvidenceEqualityTag?: string | null;
}>): AutomationRunItem | null {
    const existing = params.rows.find((row) => {
        if (row.automationId !== params.automationId) return false;
        if (params.cause.kind === "trigger") {
            return row.triggerId === params.cause.triggerId
                && row.occurrenceKey === params.cause.occurrenceKey;
        }
        if (params.cause.kind === "conversation") {
            return row.causeKind === "conversation"
                && row.occurrenceKey === params.cause.occurrenceKey;
        }
        if (params.manualIdempotencyKey !== undefined) {
            return row.causeKind === "manual"
                && row.occurrenceKey === deriveAutomationManualOccurrenceKeyV1({
                    automationId: params.automationId,
                    idempotencyKey: params.manualIdempotencyKey,
                });
        }
        return params.legacyV2ManualIdempotencyKey !== undefined
            && row.causeKind === "manual"
            && row.legacyManualIdempotencyKey === params.legacyV2ManualIdempotencyKey;
    }) ?? null;
    if (!existing) return null;
    if (!sameOccurrenceCause(decodeAutomationRunCause(existing), params.cause)
        || existing.occurrenceEvidenceEqualityTag !== (params.occurrenceEvidenceEqualityTag ?? null)) {
        throw new Error("Automation occurrence identity collided with different immutable cause evidence");
    }
    return existing;
}

const automationAdmissionDefinitionSelect = {
    id: true,
    enabled: true,
    targetType: true,
    templateVersion: true,
    templateCiphertext: true,
    assignments: {
        where: { enabled: true },
        select: {
            machineId: true,
            priority: true,
            machine: {
                select: { accountId: true, revokedAt: true, replacedByMachineId: true },
            },
        },
        orderBy: [{ priority: "desc" as const }, { machineId: "asc" as const }],
    },
} satisfies Prisma.AutomationSelect;

type AutomationAdmissionDefinition = Prisma.AutomationGetPayload<{
    select: typeof automationAdmissionDefinitionSelect;
}>;

const automationAdmissionTriggerSelect = {
    id: true,
    automationId: true,
    enabled: true,
    revision: true,
    kind: true,
} satisfies Prisma.AutomationTriggerSelect;

type AutomationAdmissionTrigger = Prisma.AutomationTriggerGetPayload<{
    select: typeof automationAdmissionTriggerSelect;
}>;

type PreparedAutomationRunAdmission = Readonly<{
    request: AutomationRunAdmissionRequest;
    cause: AutomationRunCause;
    executionInputEnvelope: string;
    automation: AutomationAdmissionDefinition;
}>;

type PreparedAutomationRunAdmissionResult =
    | AutomationRunAdmissionResult
    | Readonly<{ kind: "prepared"; admission: PreparedAutomationRunAdmission }>;

function consumesEventConversationCapacity(cause: AutomationRunCause): boolean {
    return cause.kind === "conversation"
        || (cause.kind === "trigger" && cause.triggerKind === "pluginEvent");
}

function prepareAutomationRunAdmission(params: Readonly<{
    request: AutomationRunAdmissionRequest;
    cause: AutomationRunCause;
    existingRuns: readonly AutomationRunItem[];
    automationsById: ReadonlyMap<string, AutomationAdmissionDefinition>;
    triggersById: ReadonlyMap<string, AutomationAdmissionTrigger>;
}>): PreparedAutomationRunAdmissionResult {
    const cause = params.cause;
    const existing = findExistingRun({
        rows: params.existingRuns,
        ...params.request,
        cause,
    });
    if (existing) return { kind: "rejoined", run: existing };

    const automation = params.automationsById.get(params.request.automationId);
    if (!automation) return { kind: "ineligible", reason: "automationNotFound" };
    if (!automation.enabled) return { kind: "ineligible", reason: "automationDisabled" };
    const assignmentMayBeFrozen = (assignment: AutomationAdmissionDefinition["assignments"][number]): boolean => {
        const availability = classifyMachineAvailabilityState(assignment.machine);
        return availability === "available"
            || (cause.kind === "trigger"
                && cause.triggerKind === "sessionLifecycle"
                && availability === "replaced");
    };
    const admissionAutomation: AutomationAdmissionDefinition = {
        ...automation,
        assignments: automation.assignments.filter(assignmentMayBeFrozen),
    };
    // The select loads only enabled assignments. Replayable causes freeze only
    // presently available machines; the one-shot exact-turn cause may retain a
    // reversibly replaced machine so undo can make the already-admitted Run
    // claimable. An empty post-policy snapshot is permanently unclaimable.
    // Rejoin above keeps already-admitted Runs on their immutable snapshots.
    if (admissionAutomation.assignments.length === 0) {
        return { kind: "ineligible", reason: "noEnabledAssignment" };
    }
    if (cause.kind === "trigger") {
        const trigger = params.triggersById.get(cause.triggerId);
        if (!trigger || trigger.automationId !== params.request.automationId) {
            return { kind: "ineligible", reason: "triggerNotFound" };
        }
        if (!trigger.enabled) return { kind: "ineligible", reason: "triggerDisabled" };
        if (trigger.revision !== cause.triggerRevision) {
            return { kind: "ineligible", reason: "triggerRevisionMismatch" };
        }
        if (trigger.kind !== cause.triggerKind) {
            return { kind: "ineligible", reason: "triggerKindMismatch" };
        }
    }

    const definition = parseAutomationStoredDefinitionExecutionRecipeV1(automation.templateCiphertext);
    const triggerEvidence = parseTriggerEvidenceEnvelope(
        params.request.executionTriggerEvidenceEnvelope ?? params.request.triggerEvidenceEnvelope,
    );
    let executionInputEnvelope: string;
    if (definition.kind === "available") {
        if (
            definition.recipe.templateVersion !== automation.templateVersion
            || definition.recipe.triggerEvidence !== null
            || targetTypeForRecipe(definition.recipe) !== automation.targetType
            || triggerEvidence === undefined
            || ((cause.kind === "conversation" || (cause.kind === "trigger" && cause.triggerKind === "pluginEvent"))
                && triggerEvidence === null)
            || ((cause.kind === "manual" || (cause.kind === "trigger" && cause.triggerKind !== "pluginEvent"))
                && triggerEvidence !== null)
        ) return { kind: "ineligible", reason: "definitionInvalid" };
        const frozen = serializeAutomationRunExecutionRecipeV1({
            ...definition.recipe,
            triggerEvidence,
            assignmentMachineIds: admissionAutomation.assignments.map((assignment) => assignment.machineId),
        });
        if (frozen.kind !== "available") return { kind: "ineligible", reason: "definitionInvalid" };
        executionInputEnvelope = frozen.serialized;
    } else {
        const legacyCause = cause.kind === "manual"
            || (cause.kind === "trigger" && cause.triggerKind === "schedule");
        let legacyTemplate: unknown;
        try { legacyTemplate = JSON.parse(automation.templateCiphertext); } catch { legacyTemplate = null; }
        if (
            !legacyCause
            || automation.targetType === "execution_run"
            || triggerEvidence !== null
            || normalizeAutomationTemplateEnvelopeStoredRead(legacyTemplate) === null
        ) return { kind: "ineligible", reason: "definitionInvalid" };
        const origin = toAutomationRunExecutionInputV1Origin(cause);
        if (!origin) return { kind: "ineligible", reason: "definitionInvalid" };
        executionInputEnvelope = JSON.stringify(AutomationRunExecutionInputV1Schema.parse({
            kind: "happier_automation_run_execution_input_v1",
            targetType: automation.targetType,
            templateVersion: automation.templateVersion,
            templateCiphertext: automation.templateCiphertext,
            origin,
        }));
    }

    return {
        kind: "prepared",
        admission: {
            request: params.request,
            cause,
            executionInputEnvelope,
            automation: admissionAutomation,
        },
    };
}

async function insertPreparedAutomationRunTx(params: Readonly<{
    tx: Tx;
    accountId: string;
    admission: PreparedAutomationRunAdmission;
}>): Promise<AutomationRunAdmissionResult> {
    const { request, cause, executionInputEnvelope, automation } = params.admission;
    const dueAt = cause.kind === "trigger" && cause.triggerKind === "schedule"
        ? new Date(cause.evidence.scheduledFor)
        : request.now;
    const causeFields = encodeAutomationRunCause(cause);
    const runId = request.replyHandoff ? randomUUID() : null;
    const initialExecutionDispatchState = initialAutomationExecutionDispatchStateForRun(
        executionInputEnvelope,
    );
    const run = await params.tx.automationRun.create({
        data: {
            ...(runId !== null ? { id: runId } : {}),
            automationId: request.automationId,
            accountId: params.accountId,
            state: "queued",
            ...causeFields,
            ...(cause.kind === "manual" && request.manualIdempotencyKey
                ? {
                    occurrenceKey: deriveAutomationManualOccurrenceKeyV1({
                        automationId: request.automationId,
                        idempotencyKey: request.manualIdempotencyKey,
                    }),
                }
                : {}),
            legacyManualIdempotencyKey: cause.kind === "manual"
                ? request.legacyV2ManualIdempotencyKey ?? null
                : null,
            occurrenceEvidenceEqualityTag: request.occurrenceEvidenceEqualityTag ?? null,
            triggerEvidenceEnvelope: request.triggerEvidenceEnvelope ?? null,
            executionInputEnvelope,
            executionDispatchState: initialExecutionDispatchState,
            assignments: {
                // Query index derived atomically from current strict recipe
                // assignmentMachineIds. Released V2 cannot gain that field,
                // so this child index is its isolated compatibility carrier.
                create: automation.assignments.map((assignment) => ({
                    machineId: assignment.machineId,
                    priority: assignment.priority,
                })),
            },
            scheduledAt: request.now,
            dueAt,
            ...(request.replyHandoff && runId !== null
                ? {
                    replyContextEnvelope: request.replyHandoff.contextEnvelope,
                    replyHandoffActionPluginId: request.replyHandoff.actionPluginId,
                    replyHandoffActionLocalId: request.replyHandoff.actionLocalId,
                    replyHandoffTargetMachineId: request.replyHandoff.targetMachineId,
                    replyHandoffTargetMachineInstallationId: request.replyHandoff.targetMachineInstallationId,
                    replyHandoffTargetMaterializationId: request.replyHandoff.targetMaterializationId,
                    replyHandoffId: replyHandoffIdForRun(runId),
                    replyHandoffState: "awaitingResult" as const,
                }
                : {}),
        } satisfies Prisma.AutomationRunUncheckedCreateInput,
        select: automationRunItemSelect,
    });
    await params.tx.automation.update({
        where: { id: request.automationId },
        data: { lastRunAt: request.now },
    });
    const cursor = await markAccountChanged(params.tx, {
        accountId: params.accountId,
        kind: "automation",
        entityId: request.automationId,
    });
    afterTx(params.tx, () => {
        emitAutomationRunTransition({
            accountId: params.accountId,
            run,
            previousState: null,
            cursor,
        });
        for (const assignment of automation.assignments) {
            emitAutomationRunUpdatedToMachineOnly({
                accountId: params.accountId,
                machineId: assignment.machineId,
                run,
                cursor,
            });
        }
    });
    return { kind: "admitted", run };
}

/**
 * The one admission owner for trigger and direct invocation batches. It
 * rejoins immutable occurrences before mutable checks, freezes current recipe
 * and assignments, and applies Event/Conversation capacity once across every
 * net-new capacity-consuming candidate in this bounded request.
 */
export async function admitAutomationRunsTx(params: Readonly<{
    tx: Tx;
    accountId: string;
    admissions: readonly AutomationRunAdmissionRequest[];
}>): Promise<readonly AutomationRunAdmissionResult[]> {
    if (params.admissions.length === 0) return [];
    const parsedAdmissions = params.admissions.map((request) => ({
        request,
        cause: AutomationRunCauseSchema.parse(request.cause),
    }));
    const occurrenceDiscriminators = [...new Map(parsedAdmissions.flatMap(({ request, cause }) => {
        const discriminator = occurrenceDiscriminator({
            automationId: request.automationId,
            cause,
            manualIdempotencyKey: request.manualIdempotencyKey,
            legacyV2ManualIdempotencyKey: request.legacyV2ManualIdempotencyKey,
        });
        return discriminator === null ? [] : [[JSON.stringify(discriminator), discriminator] as const];
    })).values()];
    // Membership probes fan out with the triggering batch; SQLite's portable
    // bind ceiling is a provider transport fact, never a cap on admitted work.
    const existingRuns = occurrenceDiscriminators.length === 0
        ? []
        : (await Promise.all(automationPortableQueryChunks({
            values: occurrenceDiscriminators,
            // Trigger occurrences bind two columns, while Conversation and
            // released manual idempotency bind three. Account ownership adds
            // one fixed predicate. Use the worst canonical arm so a mixed
            // batch cannot cross SQLite's provider bind boundary.
            bindingsPerValue: 3,
            fixedBindings: 1,
        }).map((chunk) => params.tx.automationRun.findMany({
            where: { accountId: params.accountId, OR: [...chunk] },
            select: automationRunItemSelect,
        })))).flat();
    const automationIds = [...new Set(parsedAdmissions.map(({ request }) => request.automationId))];
    const triggerIds = [...new Set(parsedAdmissions.flatMap(({ cause }) => (
        cause.kind === "trigger" ? [cause.triggerId] : []
    )))];
    const automations = (await Promise.all(automationPortableQueryChunks({
        values: automationIds,
        bindingsPerValue: 1,
        fixedBindings: 1,
    }).map((chunk) => params.tx.automation.findMany({
        where: {
            id: { in: [...chunk] },
            accountId: params.accountId,
            deletedAt: null,
        },
        select: automationAdmissionDefinitionSelect,
    })))).flat();
    const triggers = triggerIds.length === 0
        ? []
        : (await Promise.all(automationPortableQueryChunks({
            values: triggerIds,
            bindingsPerValue: 1,
            fixedBindings: 1,
        }).map((chunk) => params.tx.automationTrigger.findMany({
            where: { id: { in: [...chunk] }, deletedAt: null },
            select: automationAdmissionTriggerSelect,
        })))).flat();
    // Definition assignments are mutable configuration and intentionally
    // survive reversible machine replacement. Account ownership and permanent
    // revocation are cause-independent. The preparation owner below applies
    // the cause-specific availability rule: replayable causes freeze only
    // available machines, while non-replayable exact-turn occurrences also
    // preserve reversibly replaced machines for natural claim after undo.
    const automationsById = new Map(automations.map((automation) => [
        automation.id,
        {
            ...automation,
            assignments: automation.assignments.filter((assignment) => (
                assignment.machine.accountId === params.accountId
                && classifyMachineAvailabilityState(assignment.machine) !== "revoked"
            )),
        },
    ]));
    const triggersById = new Map(triggers.map((trigger) => [trigger.id, trigger]));
    const prepared = parsedAdmissions.map(({ request, cause }) => prepareAutomationRunAdmission({
        request,
        cause,
        existingRuns,
        automationsById,
        triggersById,
    }));

    const netNewCapacityAdmissions = prepared.filter((result): result is Readonly<{
        kind: "prepared";
        admission: PreparedAutomationRunAdmission;
    }> => result.kind === "prepared" && consumesEventConversationCapacity(result.admission.cause));
    let remainingCapacity = MAX_NON_TERMINAL_EVENT_CONVERSATION_RUNS_PER_ACCOUNT;
    if (netNewCapacityAdmissions.length > 0) {
        const occupied = await params.tx.automationRun.count({
            where: {
                accountId: params.accountId,
                OR: [
                    { causeKind: "conversation" },
                    { causeKind: "trigger", causeTriggerKind: "pluginEvent" },
                ],
                state: { notIn: [...AUTOMATION_RUN_TERMINAL_STATES] },
            },
        });
        remainingCapacity = Math.max(
            0,
            MAX_NON_TERMINAL_EVENT_CONVERSATION_RUNS_PER_ACCOUNT - occupied,
        );
    }
    const results: AutomationRunAdmissionResult[] = [];
    for (const result of prepared) {
        if (result.kind !== "prepared") {
            results.push(result);
            continue;
        }
        const consumesCapacity = consumesEventConversationCapacity(result.admission.cause);
        if (consumesCapacity && remainingCapacity === 0) {
            results.push({ kind: "ineligible", reason: "capacity" });
            continue;
        }
        const inserted = await insertPreparedAutomationRunTx({
            tx: params.tx,
            accountId: params.accountId,
            admission: result.admission,
        });
        results.push(inserted);
        if (consumesCapacity && inserted.kind === "admitted") {
            remainingCapacity -= 1;
        }
    }
    return results;
}

/** The scalar adapter over the canonical bounded admission owner. */
export async function admitAutomationRunTx(params: Readonly<{
    tx: Tx;
    accountId: string;
}> & AutomationRunAdmissionRequest): Promise<AutomationRunAdmissionResult> {
    const [result] = await admitAutomationRunsTx({
        tx: params.tx,
        accountId: params.accountId,
        admissions: [params],
    });
    if (!result) throw new Error("Automation admission produced no result");
    return result;
}

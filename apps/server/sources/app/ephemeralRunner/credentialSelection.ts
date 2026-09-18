import { pluginJsonValuesEqual } from "@happier-dev/protocol";
import { RunnerCredentialSelectionBindingV1Schema } from "@happier-dev/protocol/ephemeralRunner/review";
import {
    RunnerCredentialSelectionResolutionRequestV1Schema,
    TeamCredentialRequestPolicyV1Schema,
    TeamCredentialSourceBindingV1Schema,
    type RunnerCredentialSelectionResolutionRequestV1,
    type RunnerCredentialSelectionResolutionResponseV1,
    type TeamCredentialSourceBindingV1,
} from "@happier-dev/protocol/teams";

import {
    acquireAccountSessionOwnerMetadataFenceInTx,
    AccountSessionOwnerMetadataFenceAccountNotFoundError,
} from "@/app/encryption/accountSessionOwnerMetadataFence";
import type { SessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication";
import { projectTeamCredentialProviderModels } from "@/app/teams/credentials/providerModelProjection";
import {
    resolvePlannedRunnerCredentialSelectionBindingInTx,
} from "@/app/teams/credentials/sessionBinding";
import { inTx } from "@/storage/inTx";
import { readRunnerCreatorCurrentnessInTx, reconcileRunnerActivationCurrentnessInTx } from "./activationCurrentness";
import {
    StoredRunnerCredentialSelectionV1Schema,
    type StoredRunnerCredentialSelectionV1,
} from "./credentialSelectionRecord";
import { readRunnerActivationAuthentication } from "./activationAuthentication";
import { readRunnerConsentDisplayFactsInTx } from "./runnerConsentDisplayFacts";

type ProviderProjectionInput = Readonly<{
    custodianAccountId: string;
    brokerMachineId: string;
    source: TeamCredentialSourceBindingV1;
    request: RunnerCredentialSelectionResolutionRequestV1;
}>;

type CurrentSelection = Readonly<{
    binding: Readonly<{ v: 1; resourceId: string; brokerMachineId: string; revision: number }>;
    custodianAccountId: string;
    teamId: string;
    source: TeamCredentialSourceBindingV1;
    allowedModelIds: readonly string[] | null;
}>;

type SelectionPhase =
    | Readonly<{ ok: true; value: CurrentSelection }>
    | Readonly<{ ok: false; reason: Extract<RunnerCredentialSelectionResolutionResponseV1, { status: "unavailable" }>['reason'] }>;

type FrozenSelectionRead =
    | Readonly<{ status: "absent" }>
    | Readonly<{
        status: "resolved";
        value: StoredRunnerCredentialSelectionV1;
        displayFacts: NonNullable<Awaited<ReturnType<typeof readRunnerConsentDisplayFactsInTx>>>;
    }>
    | Readonly<{ status: "unavailable"; reason: Extract<RunnerCredentialSelectionResolutionResponseV1, { status: "unavailable" }>['reason'] }>;

async function readFrozenSelection(input: Readonly<{
    activationId: string;
    creatorAccountId: string;
    request: RunnerCredentialSelectionResolutionRequestV1;
    authentication: SessionAccessAuthentication;
}>): Promise<FrozenSelectionRead> {
    try {
        return await inTx(async (tx) => {
            const initial = await tx.ephemeralRunnerActivation.findUnique({ where: { id: input.activationId } });
            if (!initial || initial.creatorAccountId !== input.creatorAccountId) {
                return { status: "unavailable", reason: "activation_unavailable" } as const;
            }
            await acquireAccountSessionOwnerMetadataFenceInTx(tx, initial.creatorAccountId);
            const fenced = await tx.ephemeralRunnerActivation.findUnique({ where: { id: input.activationId } });
            if (!fenced || fenced.creatorAccountId !== input.creatorAccountId) {
                return { status: "unavailable", reason: "activation_unavailable" } as const;
            }
            const current = await readRunnerCreatorCurrentnessInTx(tx, fenced.creatorAccountId);
            const row = await reconcileRunnerActivationCurrentnessInTx(tx, fenced, current);
            if (current.status !== "ready" || row.state === "closed") {
                return { status: "unavailable", reason: "activation_unavailable" } as const;
            }
            if (row.state !== "claimed" || row.endpointFacts === null || row.review !== null) {
                return { status: "unavailable", reason: "activation_conflict" } as const;
            }
            if (row.credentialSelection === null) return { status: "absent" } as const;
            const stored = StoredRunnerCredentialSelectionV1Schema.safeParse(row.credentialSelection);
            if (!stored.success || !pluginJsonValuesEqual(stored.data.request, input.request)) {
                return { status: "unavailable", reason: "activation_conflict" } as const;
            }
            // This activation record remains the selection authority, but not
            // an authentication exemption: every recovery re-enters the same
            // planned-resource owner with this activation's credential snapshot.
            const currentBinding = await resolvePlannedRunnerCredentialSelectionBindingInTx(tx, {
                accountId: input.creatorAccountId,
                resourceId: input.request.selection.resourceId,
                expectedResourceRevision: input.request.selection.expectedResourceRevision,
                plannedSession: input.request.plannedSession,
                authentication: readRunnerActivationAuthentication(row, input.authentication.env),
                selectedBrokerMachineId: stored.data.binding.brokerMachineId,
            });
            if (!currentBinding.ok) return { status: "unavailable", reason: currentBinding.reason } as const;
            if (!pluginJsonValuesEqual(currentBinding.binding, {
                v: 1,
                resourceId: stored.data.binding.resourceId,
                brokerMachineId: stored.data.binding.brokerMachineId,
                revision: stored.data.binding.revision,
            })) {
                return { status: "unavailable", reason: "resource_changed" } as const;
            }
            const displayFacts = await readRunnerConsentDisplayFactsInTx({
                tx,
                homeServerIdentityId: row.homeServerIdentityId,
                creatorAccountId: input.creatorAccountId,
                teamId: input.request.selection.teamId,
            });
            return displayFacts
                ? { status: "resolved", value: stored.data, displayFacts } as const
                : { status: "unavailable", reason: "activation_unavailable" } as const;
        });
    } catch (error) {
        if (error instanceof AccountSessionOwnerMetadataFenceAccountNotFoundError) {
            return { status: "unavailable", reason: "activation_unavailable" };
        }
        throw error;
    }
}

async function freezeSelection(input: Readonly<{
    activationId: string;
    creatorAccountId: string;
    request: RunnerCredentialSelectionResolutionRequestV1;
    authentication: SessionAccessAuthentication;
    binding: StoredRunnerCredentialSelectionV1["binding"];
}>): Promise<RunnerCredentialSelectionResolutionResponseV1> {
    try {
        return await inTx(async (tx) => {
            const initial = await tx.ephemeralRunnerActivation.findUnique({ where: { id: input.activationId } });
            if (!initial || initial.creatorAccountId !== input.creatorAccountId) {
                return { v: 1, status: "unavailable", reason: "activation_unavailable" } as const;
            }
            await acquireAccountSessionOwnerMetadataFenceInTx(tx, initial.creatorAccountId);
            const fenced = await tx.ephemeralRunnerActivation.findUnique({ where: { id: input.activationId } });
            if (!fenced || fenced.creatorAccountId !== input.creatorAccountId) {
                return { v: 1, status: "unavailable", reason: "activation_unavailable" } as const;
            }
            const current = await readRunnerCreatorCurrentnessInTx(tx, fenced.creatorAccountId);
            const row = await reconcileRunnerActivationCurrentnessInTx(tx, fenced, current);
            if (current.status !== "ready" || row.state === "closed") {
                return { v: 1, status: "unavailable", reason: "activation_unavailable" } as const;
            }
            if (row.state !== "claimed" || row.endpointFacts === null || row.review !== null) {
                return { v: 1, status: "unavailable", reason: "activation_conflict" } as const;
            }
            if (row.credentialSelection !== null) {
                const stored = StoredRunnerCredentialSelectionV1Schema.safeParse(row.credentialSelection);
                if (!stored.success || !pluginJsonValuesEqual(stored.data.request, input.request)) {
                    return { v: 1, status: "unavailable", reason: "activation_conflict" } as const;
                }
                const currentBinding = await resolvePlannedRunnerCredentialSelectionBindingInTx(tx, {
                    accountId: input.creatorAccountId,
                    resourceId: input.request.selection.resourceId,
                    expectedResourceRevision: input.request.selection.expectedResourceRevision,
                    plannedSession: input.request.plannedSession,
                    authentication: readRunnerActivationAuthentication(row, input.authentication.env),
                    selectedBrokerMachineId: stored.data.binding.brokerMachineId,
                });
                if (!currentBinding.ok) return { v: 1, status: "unavailable", reason: currentBinding.reason } as const;
                if (!pluginJsonValuesEqual(currentBinding.binding, {
                    v: 1,
                    resourceId: stored.data.binding.resourceId,
                    brokerMachineId: stored.data.binding.brokerMachineId,
                    revision: stored.data.binding.revision,
                })) {
                    return { v: 1, status: "unavailable", reason: "resource_changed" } as const;
                }
                const displayFacts = await readRunnerConsentDisplayFactsInTx({
                    tx,
                    homeServerIdentityId: row.homeServerIdentityId,
                    creatorAccountId: input.creatorAccountId,
                    teamId: input.request.selection.teamId,
                });
                return displayFacts
                    ? { v: 1, status: "resolved", credentialSelectionBinding: stored.data.binding, displayFacts } as const
                    : { v: 1, status: "unavailable", reason: "activation_unavailable" } as const;
            }
            const currentBinding = await resolvePlannedRunnerCredentialSelectionBindingInTx(tx, {
                accountId: input.creatorAccountId,
                resourceId: input.request.selection.resourceId,
                expectedResourceRevision: input.request.selection.expectedResourceRevision,
                plannedSession: input.request.plannedSession,
                authentication: readRunnerActivationAuthentication(row, input.authentication.env),
                selectedBrokerMachineId: input.binding.brokerMachineId,
            });
            if (!currentBinding.ok) return { v: 1, status: "unavailable", reason: currentBinding.reason } as const;
            if (!pluginJsonValuesEqual(currentBinding.binding, {
                v: 1,
                resourceId: input.binding.resourceId,
                brokerMachineId: input.binding.brokerMachineId,
                revision: input.binding.revision,
            })) return { v: 1, status: "unavailable", reason: "resource_changed" } as const;
            const stored = StoredRunnerCredentialSelectionV1Schema.parse({
                v: 1,
                request: input.request,
                binding: input.binding,
            });
            await tx.ephemeralRunnerActivation.update({
                where: { id: row.id },
                data: { credentialSelection: stored },
            });
            const displayFacts = await readRunnerConsentDisplayFactsInTx({
                tx,
                homeServerIdentityId: row.homeServerIdentityId,
                creatorAccountId: input.creatorAccountId,
                teamId: input.request.selection.teamId,
            });
            return displayFacts
                ? { v: 1, status: "resolved", credentialSelectionBinding: stored.binding, displayFacts } as const
                : { v: 1, status: "unavailable", reason: "activation_unavailable" } as const;
        });
    } catch (error) {
        if (error instanceof AccountSessionOwnerMetadataFenceAccountNotFoundError) {
            return { v: 1, status: "unavailable", reason: "activation_unavailable" };
        }
        throw error;
    }
}

async function readCurrentSelection(input: Readonly<{
    activationId: string;
    creatorAccountId: string;
    request: RunnerCredentialSelectionResolutionRequestV1;
    authentication: SessionAccessAuthentication;
    selectedBrokerMachineId?: string;
}>): Promise<SelectionPhase> {
    try {
        return await inTx(async (tx) => {
            const initial = await tx.ephemeralRunnerActivation.findUnique({ where: { id: input.activationId } });
            if (!initial || initial.creatorAccountId !== input.creatorAccountId) {
                return { ok: false, reason: "activation_unavailable" } as const;
            }
            await acquireAccountSessionOwnerMetadataFenceInTx(tx, initial.creatorAccountId);
            const fenced = await tx.ephemeralRunnerActivation.findUnique({ where: { id: input.activationId } });
            if (!fenced || fenced.creatorAccountId !== input.creatorAccountId) {
                return { ok: false, reason: "activation_unavailable" } as const;
            }
            const current = await readRunnerCreatorCurrentnessInTx(tx, fenced.creatorAccountId);
            const row = await reconcileRunnerActivationCurrentnessInTx(tx, fenced, current);
            if (current.status !== "ready" || row.state === "closed") {
                return { ok: false, reason: "activation_unavailable" } as const;
            }
            if (row.state !== "claimed" || row.endpointFacts === null || row.review !== null) {
                return { ok: false, reason: "activation_conflict" } as const;
            }
            const resource = await tx.teamCredentialResource.findUnique({
                where: { id: input.request.selection.resourceId },
                select: {
                    teamId: true,
                    custodianAccountId: true,
                    sourceBindingJson: true,
                    requestPolicyJson: true,
                },
            });
            if (!resource) return { ok: false, reason: "resource_missing" } as const;
            if (resource.teamId !== input.request.selection.teamId) {
                return { ok: false, reason: "resource_changed" } as const;
            }
            let rawSource: unknown;
            let rawPolicy: unknown = null;
            try {
                rawSource = JSON.parse(resource.sourceBindingJson);
                rawPolicy = resource.requestPolicyJson === null ? null : JSON.parse(resource.requestPolicyJson);
            } catch {
                return { ok: false, reason: "resource_corrupt" } as const;
            }
            const source = TeamCredentialSourceBindingV1Schema.safeParse(rawSource);
            const policy = TeamCredentialRequestPolicyV1Schema.nullable().safeParse(rawPolicy);
            if (!source.success || !policy.success) return { ok: false, reason: "resource_corrupt" } as const;
            const resolved = await resolvePlannedRunnerCredentialSelectionBindingInTx(tx, {
                accountId: input.creatorAccountId,
                resourceId: input.request.selection.resourceId,
                expectedResourceRevision: input.request.selection.expectedResourceRevision,
                plannedSession: input.request.plannedSession,
                authentication: readRunnerActivationAuthentication(row, input.authentication.env),
                ...(input.selectedBrokerMachineId ? { selectedBrokerMachineId: input.selectedBrokerMachineId } : {}),
            });
            if (!resolved.ok) return resolved;
            return { ok: true, value: {
                binding: resolved.binding,
                custodianAccountId: resource.custodianAccountId,
                teamId: resource.teamId,
                source: source.data,
                allowedModelIds: policy.data?.allowedModelIds ?? null,
            } } as const;
        });
    } catch (error) {
        if (error instanceof AccountSessionOwnerMetadataFenceAccountNotFoundError) {
            return { ok: false, reason: "activation_unavailable" };
        }
        throw error;
    }
}

/**
 * Authenticated, bounded pre-Session resolution for the resource owner's exact
 * persistent broker Machine. It performs no model request, credential export,
 * Session allocation, lease, Pool placement, or token lifecycle.
 */
export async function resolveRunnerCredentialSelection(input: Readonly<{
    activationId: string;
    creatorAccountId: string;
    request: unknown;
    authentication: SessionAccessAuthentication;
    readProviderProjection: (input: ProviderProjectionInput) => Promise<unknown>;
}>): Promise<RunnerCredentialSelectionResolutionResponseV1> {
    const request = RunnerCredentialSelectionResolutionRequestV1Schema.safeParse(input.request);
    if (!request.success) return { v: 1, status: "unavailable", reason: "invalid_input" };
    const frozen = await readFrozenSelection({ ...input, request: request.data });
    if (frozen.status === "unavailable") return { v: 1, status: "unavailable", reason: frozen.reason };
    if (frozen.status === "resolved") {
        return { v: 1, status: "resolved", credentialSelectionBinding: frozen.value.binding, displayFacts: frozen.displayFacts };
    }
    const before = await readCurrentSelection({ ...input, request: request.data });
    if (!before.ok) return { v: 1, status: "unavailable", reason: before.reason };
    let response: unknown;
    try {
        response = await input.readProviderProjection({
            custodianAccountId: before.value.custodianAccountId,
            brokerMachineId: before.value.binding.brokerMachineId,
            source: before.value.source,
            request: request.data,
        });
    } catch {
        return { v: 1, status: "unavailable", reason: "application_unavailable" };
    }
    const candidates = projectTeamCredentialProviderModels({
        response,
        resourceId: before.value.binding.resourceId,
        teamId: before.value.teamId,
        resourceRevision: before.value.binding.revision,
        agentTargetKey: request.data.selection.agentTargetKey,
        application: request.data.application,
        allowedModelIds: before.value.allowedModelIds,
        source: before.value.source,
        deliveryMode: "brokered",
    });
    const selected = candidates.find(candidate => (
        candidate.selection.modelId === request.data.selection.modelId
        && candidate.sourceRevision === request.data.sourceRevision
        && pluginJsonValuesEqual(candidate.application, request.data.application)
    ));
    if (!selected) {
        const sourceStillPresent = candidates.some(candidate => candidate.sourceRevision === request.data.sourceRevision);
        return { v: 1, status: "unavailable", reason: sourceStillPresent ? "model_unavailable" : "source_changed" };
    }
    const after = await readCurrentSelection({ ...input, request: request.data });
    if (!after.ok) return { v: 1, status: "unavailable", reason: after.reason };
    if (!pluginJsonValuesEqual(before.value.binding, after.value.binding)) {
        return { v: 1, status: "unavailable", reason: "resource_changed" };
    }
    return await freezeSelection({
        activationId: input.activationId,
        creatorAccountId: input.creatorAccountId,
        request: request.data,
        authentication: input.authentication,
        binding: RunnerCredentialSelectionBindingV1Schema.parse({
            ...after.value.binding,
            application: request.data.application,
            sourceRevision: request.data.sourceRevision,
        }),
    });
}

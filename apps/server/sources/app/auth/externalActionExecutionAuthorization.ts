import {
    ExternalActionActionIdV1Schema,
    bindExternalActionExecutionAuthorizationVerifyHttpPathV1,
    decodeExternalActionResolvedTargetV1,
    encodeExternalActionResolvedTargetV1,
    getActionSpec,
    isExternalActionResolvedTargetAllowedV1,
    PublicActionIdSchema,
    verifyExternalActionMachineRpcRequestV1,
    verifyExternalActionMachineRequestV1,
    type ExternalActionExecutionAuthorizationBindingV1,
    type ExternalActionMachineRpcExecutionV1,
    type ExternalActionTargetV1,
} from "@happier-dev/protocol/actions";
import { SOCKET_RPC_EVENTS } from "@happier-dev/protocol/socketRpc";

import { classifyMachineAvailabilityState } from "@/app/machines/machineStateGuards";
import { getOrCreateServerIdentityId } from "@/app/serverIdentity/serverIdentity";
import { db } from "@/storage/db";
import { enforceLoginEligibility } from "./enforceLoginEligibility";

import { auth, type VerifiedApiTokenPrincipal } from "./auth";

async function verifyCurrentExternalActionPrincipal(
    binding: ExternalActionExecutionAuthorizationBindingV1,
): Promise<VerifiedApiTokenPrincipal | null> {
    const principal = await auth.verifyCurrentApiTokenPrincipal(binding);
    if (!principal) return null;
    const eligibility = await enforceLoginEligibility({ accountId: principal.accountId, env: process.env });
    return eligibility.ok ? principal : null;
}

export type VerifiedExternalActionExecutionRequest = Readonly<{
    binding: ExternalActionExecutionAuthorizationBindingV1;
    effectActionId: string;
    target: ExternalActionTargetV1;
    principal: VerifiedApiTokenPrincipal;
}>;

type ExternalActionExecutionRequestProof = Readonly<{
    authorizationToken: string;
    machineSignature: string;
    effectActionId: string;
    encodedTarget: string;
    method: string;
    path: string;
    body: unknown;
}>;

async function verifyCommon(
    proof: ExternalActionExecutionRequestProof,
): Promise<VerifiedExternalActionExecutionRequest | null> {
    const effectActionId = ExternalActionActionIdV1Schema.safeParse(proof.effectActionId);
    const target = decodeExternalActionResolvedTargetV1(proof.encodedTarget);
    if (!effectActionId.success || !target) return null;

    const binding = await auth.verifyExternalActionExecutionAuthorization(proof.authorizationToken);
    if (!binding || !isExternalActionResolvedTargetAllowedV1({
        authorizedTarget: binding.target,
        resolvedTarget: target,
        selectedMachineId: binding.machineId,
    })) return null;
    if (binding.serverIdentityId !== await getOrCreateServerIdentityId()) return null;

    const machine = await db.machine.findFirst({
        where: { id: binding.machineId, accountId: binding.accountId },
        select: {
            revokedAt: true,
            replacedByMachineId: true,
            installationId: true,
            installationPublicKey: true,
        },
    });
    if (
        !machine
        || classifyMachineAvailabilityState(machine) !== "available"
        || !machine.installationId
        || !machine.installationPublicKey
        || !verifyExternalActionMachineRequestV1({
            authorizationToken: proof.authorizationToken,
            effectActionId: effectActionId.data,
            target,
            installationId: machine.installationId,
            requestId: binding.requestId,
            method: proof.method,
            path: proof.path,
            body: proof.body,
            publicKey: machine.installationPublicKey,
            signature: proof.machineSignature,
        })
    ) {
        return null;
    }

    const principal = await verifyCurrentExternalActionPrincipal(binding);
    if (!principal) return null;
    return { binding, effectActionId: effectActionId.data, target, principal };
}

export async function verifyExternalActionDomainExecutionRequest(
    proof: ExternalActionExecutionRequestProof,
): Promise<VerifiedExternalActionExecutionRequest | null> {
    const verified = await verifyCommon(proof);
    if (!verified) return null;
    const effect = PublicActionIdSchema.safeParse(verified.effectActionId);
    if (!effect.success || getActionSpec(effect.data).requiredAuthority !== "account_automation") return null;
    return verified;
}

export async function verifyExternalActionMachineRpcExecution(
    execution: ExternalActionMachineRpcExecutionV1,
    request: Readonly<{ method: string; requestId?: string; params?: unknown }>,
): Promise<VerifiedExternalActionExecutionRequest | null> {
    if (!request.requestId) return null;
    const binding = await auth.verifyExternalActionExecutionAuthorization(execution.authorization.token);
    if (!binding || binding.serverIdentityId !== await getOrCreateServerIdentityId()) return null;
    const supplied = execution.authorization.binding;
    if (
        binding.serverIdentityId !== supplied.serverIdentityId
        || binding.accountId !== supplied.accountId
        || binding.principalId !== supplied.principalId
        || binding.credentialId !== supplied.credentialId
        || binding.machineId !== supplied.machineId
        || binding.actionId !== supplied.actionId
        || binding.requestId !== supplied.requestId
        || binding.requestEnvelopeDigest !== supplied.requestEnvelopeDigest
        || encodeExternalActionResolvedTargetV1(binding.target) !== encodeExternalActionResolvedTargetV1(supplied.target)
        || !isExternalActionResolvedTargetAllowedV1({
            authorizedTarget: binding.target,
            resolvedTarget: execution.target,
            selectedMachineId: binding.machineId,
        })
    ) return null;

    const effect = PublicActionIdSchema.safeParse(execution.effectActionId);
    if (!effect.success || getActionSpec(effect.data).requiredAuthority !== "account_automation") return null;
    const machine = await db.machine.findFirst({
        where: { id: binding.machineId, accountId: binding.accountId },
        select: {
            revokedAt: true,
            replacedByMachineId: true,
            installationId: true,
            installationPublicKey: true,
        },
    });
    if (
        !machine
        || classifyMachineAvailabilityState(machine) !== "available"
        || machine.installationId !== execution.installationId
        || !machine.installationPublicKey
        || !verifyExternalActionMachineRpcRequestV1({
            authorizationToken: execution.authorization.token,
            effectActionId: execution.effectActionId,
            target: execution.target,
            installationId: execution.installationId,
            event: SOCKET_RPC_EVENTS.CALL,
            method: request.method,
            requestId: request.requestId,
            ...(request.params === undefined ? {} : { params: request.params }),
            publicKey: machine.installationPublicKey,
            signature: execution.machineSignature,
        })
    ) return null;
    const principal = await verifyCurrentExternalActionPrincipal(binding);
    return principal
        ? { binding, effectActionId: execution.effectActionId, target: execution.target, principal }
        : null;
}

export async function verifyExternalActionExecutionAuthorizationCurrentness(
    proof: ExternalActionExecutionRequestProof & Readonly<{ outerActionId: string }>,
): Promise<VerifiedExternalActionExecutionRequest | null> {
    const verified = await verifyCommon(proof);
    if (!verified || verified.binding.actionId !== proof.outerActionId) return null;
    if (
        proof.method.toUpperCase() !== "POST"
        || proof.path !== bindExternalActionExecutionAuthorizationVerifyHttpPathV1(proof.outerActionId)
    ) {
        return null;
    }
    const effect = PublicActionIdSchema.safeParse(verified.effectActionId);
    if (!effect.success || getActionSpec(effect.data).requiredAuthority !== "account_automation") return null;
    return verified;
}

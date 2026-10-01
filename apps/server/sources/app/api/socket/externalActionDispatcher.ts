import { randomUUID } from "node:crypto";

import {
    EXTERNAL_ACTION_DAEMON_RPC_METHOD_V1,
    computeExternalActionRequestEnvelopeDigestV1,
    getActionSpec,
    parseExternalActionDaemonDispatchResult,
    type ExternalActionActionIdV1,
    type ExternalActionDaemonDispatchRequest,
    type ParsedExternalActionDaemonDispatchResult,
    type ExternalActionDaemonPlacementV1,
    type ExternalActionExecutionAuthorizationBindingV1,
    type ExternalActionExecutionAuthorizationV1,
    type ExternalActionRequestEnvelope,
    type ExternalActionServerPrincipalV1,
} from "@happier-dev/protocol/actions";
import {
    supportsMachineOperationProtocolCapabilityV1,
    supportsMachineSessionInputAdmissionProtocolVersion,
} from "@happier-dev/protocol";
import { ACTION_API_SERVER_ORIGIN } from "@happier-dev/protocol/rpc";
import { SOCKET_RPC_EVENTS } from "@happier-dev/protocol/socketRpc";
import type { Server } from "socket.io";

import { classifyMachineAvailabilityState } from "@/app/machines/machineStateGuards";
import { auth, ApiTokenOperationError, type ExternalActionGrantEvaluationContext } from "@/app/auth/auth";
import { readMachineDaemonSocketIdentity } from "@/app/machines/machineDaemonPresence";
import {
    readSessionPublisherAuthorityProjection,
    type createSessionPublisherPresence,
} from "@/app/presence/sessionPublisherPresence";
import { db } from "@/storage/db";
import { getAccountSessionSocketRoom } from "@/app/api/socketRooms";
import { getOrCreateServerIdentityId } from "@/app/serverIdentity/serverIdentity";

import { forwardRpcCall, type RpcForwardResult } from "./rpc/forwardRpcCall";
import { readVerifiedMachineSocketInstallationIdFromSocketData } from "./machineSocketInstallationProof";
import type { RpcAckResponseEmitter, RpcForwardTargetGuard } from "./rpc/_types";

/**
 * Reserved to the server's external Action bridge. The corresponding daemon
 * handler is intentionally not callable or registerable by ordinary sockets.
 */
export { EXTERNAL_ACTION_DAEMON_RPC_METHOD_V1 };

/**
 * Internal relay data after public ingress has validated only the bounded
 * Action-id path segment. The daemon remains the canonical owner of Action
 * semantics; this boundary only proves that a response belongs to the
 * requested relay.
 */
export type ExternalActionPlacementErrorCode =
    | "credential_scope_denied"
    | "target_required"
    | "target_not_local"
    | "target_unavailable"
    | "encrypted_action_unsupported"
    | "session_input_target_update_required";

export type ExternalActionDaemonDispatchResult =
    | ParsedExternalActionDaemonDispatchResult
    | Readonly<{ kind: "submitted_unknown" }>
    | Readonly<{ kind: "placement_error"; code: ExternalActionPlacementErrorCode }>;

export type ExternalActionDaemonDispatcher = (
    request: Readonly<{
        actionId: ExternalActionActionIdV1;
        envelope: ExternalActionRequestEnvelope;
        principal: ExternalActionServerPrincipalV1;
    }>,
    options?: Readonly<{ signal?: AbortSignal }>,
) => Promise<ExternalActionDaemonDispatchResult>;

export type ExternalActionForwardRpcCall = typeof forwardRpcCall;

type MachineResolution =
    | "available"
    | "not_owned"
    | "unavailable"
    | "external_action_update_required"
    | "session_input_update_required";

type ResolveMachine = (params: Readonly<{
    accountId: string;
    machineId: string;
    requiredExternalActionExecutionAuthorization?: true;
    requiredSessionInputAdmissionProtocolVersion?: 2;
}>) => Promise<MachineResolution>;

type ResolveSessionMachine = (params: Readonly<{
    accountId: string;
    sessionId: string;
}>) => Promise<string | null>;

type MintExecutionAuthorization = (
    binding: ExternalActionExecutionAuthorizationBindingV1,
    context?: ExternalActionGrantEvaluationContext,
) => Promise<ExternalActionExecutionAuthorizationV1>;

type SessionPublisherPresenceForExternalAction = Pick<
    ReturnType<typeof createSessionPublisherPresence>,
    "isCurrentPublisherProjection"
>;

type SocketDataCarrier = Readonly<{ data?: unknown }>;

function parseDaemonResponse(
    raw: unknown,
    expected: Readonly<{ v: 1 | 2; actionId: ExternalActionActionIdV1; requestId?: string }>,
): ParsedExternalActionDaemonDispatchResult | null {
    const result = parseExternalActionDaemonDispatchResult(raw);
    if (!result) return null;
    if (result.kind === "invalid_request") {
        // A protected pre-open failure is untrusted transport evidence, but it
        // still must belong to this exact opaque request before the relay may
        // return its bounded code. Retained V1 relay failures have no request
        // correlation field and keep their released shape.
        return expected.v === 2
            ? result.requestId === expected.requestId ? result : null
            : result.requestId === undefined ? result : null;
    }
    const response = result.prepared.response;
    if (response.v !== expected.v || response.actionId !== expected.actionId) return null;

    if (expected.requestId === undefined) {
        if (response.requestId !== undefined) return null;
    } else if (response.requestId !== expected.requestId) {
        return null;
    }

    return result;
}

async function resolveMachineFromServer(params: Readonly<{
    accountId: string;
    machineId: string;
    requiredExternalActionExecutionAuthorization?: true;
    requiredSessionInputAdmissionProtocolVersion?: 2;
}>): Promise<MachineResolution> {
    const machine = await db.machine.findFirst({
        where: { accountId: params.accountId, id: params.machineId },
        select: {
            revokedAt: true,
            replacedByMachineId: true,
            operationProtocolCapabilities: true,
            operationProtocolCapabilitiesRevision: true,
        },
    });
    if (!machine) return "not_owned";
    if (classifyMachineAvailabilityState(machine) !== "available") return "unavailable";
    const hasCurrentExternalActionAuthorization = typeof machine.operationProtocolCapabilitiesRevision === "number"
        && machine.operationProtocolCapabilitiesRevision >= 1
        && supportsMachineOperationProtocolCapabilityV1(
            machine.operationProtocolCapabilities,
            "externalActionExecutionAuthorization",
        );
    if (
        params.requiredExternalActionExecutionAuthorization === true
        && !hasCurrentExternalActionAuthorization
    ) return "external_action_update_required";
    if (params.requiredSessionInputAdmissionProtocolVersion === undefined) return "available";
    return supportsMachineSessionInputAdmissionProtocolVersion(
        machine.operationProtocolCapabilities,
        params.requiredSessionInputAdmissionProtocolVersion,
    ) ? "available" : "session_input_update_required";
}

function requiresSessionInputAdmissionV2(request: Readonly<{
    actionId: ExternalActionActionIdV1;
    envelope: ExternalActionRequestEnvelope;
}>): boolean {
    if (request.actionId !== "session.message.send") return false;
    // V2 deliberately encrypts the complete Action input, so the Home cannot
    // distinguish a main send from a Run-targeted send without violating that
    // privacy boundary. The protected transport therefore requires the daemon
    // generation that truthfully publishes targeted input admission. Released
    // plaintext V1 retains main-send compatibility and requires v2 only when
    // its visible input carries a recipient.
    if (request.envelope.v === 2) return true;
    const inputSchema = getActionSpec("session.message.send").surfaceBindings?.api?.inputSchema;
    const parsed = inputSchema?.safeParse(request.envelope.input);
    return parsed?.success === true
        && typeof parsed.data === "object"
        && parsed.data !== null
        && "recipient" in parsed.data
        && parsed.data.recipient !== undefined;
}

export async function resolveCurrentSessionMachineFromServer(params: Readonly<{
    io: Server;
    presence?: SessionPublisherPresenceForExternalAction;
    accountId: string;
    sessionId: string;
}>): Promise<string | null> {
    if (!params.presence) return null;
    let sockets: readonly SocketDataCarrier[];
    try {
        // The per-account Session room is the exact set of this Account's
        // sockets scoped to this Session, and it is what every Session-scoped
        // client joins — including a restricted Runner, which is deliberately
        // kept out of the Account-wide `user:` room. Resolving a Session
        // target from that Account-wide room therefore missed exactly the
        // publisher a Session target names.
        // Socket.IO's RemoteSocket has more fields than this resolver needs.
        sockets = await params.io
            .in(getAccountSessionSocketRoom(params.accountId, params.sessionId))
            .fetchSockets() as SocketDataCarrier[];
    } catch {
        return null;
    }

    const machineIds = new Set<string>();
    for (const socket of sockets) {
        const projection = readSessionPublisherAuthorityProjection(socket.data);
        if (!projection) continue;
        try {
            if (await params.presence.isCurrentPublisherProjection({
                expectedAccountId: params.accountId,
                expectedSessionId: params.sessionId,
                projection,
            })) {
                machineIds.add(projection.machineId);
            }
        } catch {
            // A currentness read is fail-closed; another current publisher may
            // still be discovered, but an uncertain candidate is never used.
        }
    }
    return machineIds.size === 1 ? [...machineIds][0] : null;
}

function isExactMachineDaemonTarget(
    target: Pick<RpcAckResponseEmitter, "data">,
    machineId: string,
): boolean {
    const identity = readMachineDaemonSocketIdentity(target.data);
    return identity?.machineId === machineId
        && readVerifiedMachineSocketInstallationIdFromSocketData(target.data) !== null;
}

function createExactMachineDaemonGuard(params: Readonly<{
    accountId: string;
    machineId: string;
    sessionId?: string;
    requiredExternalActionExecutionAuthorization?: true;
    requiredSessionInputAdmissionProtocolVersion?: 2;
    resolveMachine: ResolveMachine;
    resolveSessionMachine: ResolveSessionMachine;
}>): RpcForwardTargetGuard {
    const current = async (): Promise<boolean> => {
        try {
            if (await params.resolveMachine({
                accountId: params.accountId,
                machineId: params.machineId,
                ...(params.requiredExternalActionExecutionAuthorization === true
                    ? { requiredExternalActionExecutionAuthorization: true as const }
                    : {}),
                ...(params.requiredSessionInputAdmissionProtocolVersion === undefined
                    ? {}
                    : { requiredSessionInputAdmissionProtocolVersion: params.requiredSessionInputAdmissionProtocolVersion }),
            }) !== "available") {
                return false;
            }
            if (params.sessionId === undefined) return true;
            return await params.resolveSessionMachine({
                accountId: params.accountId,
                sessionId: params.sessionId,
            }) === params.machineId;
        } catch {
            return false;
        }
    };
    const exact = (target: Pick<RpcAckResponseEmitter, "data">): boolean => (
        isExactMachineDaemonTarget(target, params.machineId)
    );

    return {
        filterTargets: async (targets) => {
            if (!await current()) return [];
            return targets.filter(exact);
        },
        runOperation: async ({ target, operation, readLatestTarget }) => {
            if (!exact(target) || !await current()) return { status: "unavailable" };
            const latestTarget = await readLatestTarget();
            if (!latestTarget || !exact(latestTarget) || !await current()) {
                return { status: "unavailable" };
            }
            const value = await operation();
            return { status: "current", value };
        },
    };
}

/**
 * The sole server-side relay for an external Action request. The server owns
 * credential provenance and exact daemon placement. For raw V1 targeted
 * Session input, it consumes the ActionSpec-owned recipient projection; for
 * opaque V2 Session input, it conservatively consumes the outer Action id.
 * Both enforce the exact Machine's published admission version before relay.
 * The target daemon remains the owner of all Action semantics and policy.
 */
export function createExternalActionDaemonDispatcher(params: Readonly<{
    io: Server;
    forwardRpc?: ExternalActionForwardRpcCall;
    resolveMachine?: ResolveMachine;
    resolveSessionMachine?: ResolveSessionMachine;
    sessionPublisherPresence?: SessionPublisherPresenceForExternalAction;
    mintExecutionAuthorization?: MintExecutionAuthorization;
    getServerIdentityId?: () => Promise<string>;
}>): ExternalActionDaemonDispatcher {
    const forwardRpc = params.forwardRpc ?? forwardRpcCall;
    const resolveMachine = params.resolveMachine ?? resolveMachineFromServer;
    const resolveSessionMachine = params.resolveSessionMachine ?? (async ({ accountId, sessionId }) => (
        await resolveCurrentSessionMachineFromServer({
            io: params.io,
            presence: params.sessionPublisherPresence,
            accountId,
            sessionId,
        })
    ));
    const mintExecutionAuthorization = params.mintExecutionAuthorization
        ?? ((binding, context) => auth.mintExternalActionExecutionAuthorization(binding, context));
    const getServerIdentityId = params.getServerIdentityId ?? getOrCreateServerIdentityId;

    return async (request, options = {}): Promise<ExternalActionDaemonDispatchResult> => {
        const target = request.envelope.target;
        if (!target) {
            return { kind: "placement_error", code: "target_required" };
        }
        if (options.signal?.aborted) {
            return { kind: "placement_error", code: "target_unavailable" };
        }

        let machineId: string;
        let sessionId: string | undefined;
        if (target.kind === "machine") {
            machineId = target.machineId;
        } else {
            sessionId = target.sessionId;
            try {
                const resolved = await resolveSessionMachine({
                    accountId: request.principal.accountId,
                    sessionId,
                });
                if (!resolved) return { kind: "placement_error", code: "target_unavailable" };
                machineId = resolved;
            } catch {
                return { kind: "placement_error", code: "target_unavailable" };
            }
        }

        let availability: MachineResolution;
        const requiredSessionInputAdmissionProtocolVersion = requiresSessionInputAdmissionV2(request)
            ? 2 as const
            : undefined;
        try {
            availability = await resolveMachine({
                accountId: request.principal.accountId,
                machineId,
                requiredExternalActionExecutionAuthorization: true,
                ...(requiredSessionInputAdmissionProtocolVersion === undefined
                    ? {}
                    : { requiredSessionInputAdmissionProtocolVersion }),
            });
        } catch {
            return { kind: "placement_error", code: "target_unavailable" };
        }
        if (availability !== "available") {
            if (availability === "external_action_update_required") {
                return {
                    kind: "placement_error",
                    code: "encrypted_action_unsupported",
                };
            }
            if (availability === "session_input_update_required") {
                return {
                    kind: "placement_error",
                    code: "session_input_target_update_required",
                };
            }
            return {
                kind: "placement_error",
                code: target.kind === "machine" && availability === "not_owned"
                    ? "target_not_local"
                    : "target_unavailable",
            };
        }
        if (options.signal?.aborted) {
            return { kind: "placement_error", code: "target_unavailable" };
        }

        let executionAuthorization: ExternalActionExecutionAuthorizationV1;
        try {
            executionAuthorization = await mintExecutionAuthorization({
                serverIdentityId: await getServerIdentityId(),
                accountId: request.principal.accountId,
                principalId: request.principal.principalId,
                credentialId: request.principal.credentialId,
                grant: request.principal.grant,
                machineId,
                actionId: request.actionId,
                requestId: request.envelope.requestId ?? randomUUID(),
                requestEnvelopeDigest: computeExternalActionRequestEnvelopeDigestV1(request.envelope),
                target,
            }, { ...(request.envelope.v === 1 ? { input: request.envelope.input } : {}) });
        } catch (error) {
            if (error instanceof ApiTokenOperationError && error.code === "credential_scope_denied") {
                return { kind: "placement_error", code: "credential_scope_denied" };
            }
            return { kind: "placement_error", code: "target_unavailable" };
        }

        const placement: ExternalActionDaemonPlacementV1 = {
            machineId,
            target: { kind: "machine", machineId },
        };
        const targetGuard = createExactMachineDaemonGuard({
            accountId: request.principal.accountId,
            machineId,
            requiredExternalActionExecutionAuthorization: true,
            ...(sessionId === undefined ? {} : { sessionId }),
            ...(requiredSessionInputAdmissionProtocolVersion === undefined
                ? {}
                : { requiredSessionInputAdmissionProtocolVersion }),
            resolveMachine,
            resolveSessionMachine,
        });
        const requestId = options.signal ? randomUUID() : null;
        let targetSocketId: string | null = null;
        const cancellation = requestId && options.signal
            ? {
                targetRequestId: requestId,
                signal: options.signal,
                onTargetSelected: (targetSocket: RpcAckResponseEmitter) => {
                    targetSocketId = targetSocket.id;
                },
            }
            : null;
        const cancelTarget = (): void => {
            if (!targetSocketId || !requestId) return;
            try {
                params.io.to(targetSocketId).emit(SOCKET_RPC_EVENTS.CANCEL, { requestId });
            } catch {
                // Cancellation is best effort at the transport boundary.
            }
        };
        options.signal?.addEventListener("abort", cancelTarget, { once: true });

        let forwarded: RpcForwardResult;
        let submittedUnknown = false;
        try {
            forwarded = await forwardRpc({
                io: params.io,
                targetUserId: request.principal.accountId,
                method: `${machineId}:${EXTERNAL_ACTION_DAEMON_RPC_METHOD_V1}`,
                callParams: {
                    actionId: request.actionId,
                    envelope: request.envelope,
                    principal: request.principal,
                    placement,
                    executionAuthorization,
                } satisfies ExternalActionDaemonDispatchRequest,
                authorization: ACTION_API_SERVER_ORIGIN,
                targetGuard,
                onSubmittedUnknown: () => {
                    submittedUnknown = true;
                },
                ...(cancellation ? { cancellation } : {}),
            });
        } catch {
            if (submittedUnknown) return { kind: "submitted_unknown" };
            return { kind: "placement_error", code: "target_unavailable" };
        } finally {
            options.signal?.removeEventListener("abort", cancelTarget);
        }
        if (!forwarded.ok) {
            return submittedUnknown
                ? { kind: "submitted_unknown" }
                : { kind: "placement_error", code: "target_unavailable" };
        }

        const result = parseDaemonResponse(forwarded.result, {
            v: request.envelope.v,
            actionId: request.actionId,
            ...(request.envelope.requestId === undefined ? {} : { requestId: request.envelope.requestId }),
        });
        return result
            ? result
            : request.envelope.v === 2
                ? { kind: "submitted_unknown" }
                : { kind: "placement_error", code: "target_unavailable" };
    };
}

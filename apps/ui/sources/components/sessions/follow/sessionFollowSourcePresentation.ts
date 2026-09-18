import {
    isPersistentMachine,
    supportsMachineSessionFollowContextV1,
    supportsMachineSessionFollowWakeOnHumanChangeV1,
    type SessionFollowSourceModeV1,
    type SessionFollowSourceDeliveryStateV1,
} from '@happier-dev/protocol';

import { isMachineOnline } from '@/utils/sessions/machineUtils';

export type SessionFollowSourceRuntimeState =
    | SessionFollowSourceDeliveryStateV1
    | 'waiting_for_runtime'
    | 'runtime_unsupported'
    | 'waiting_for_source_key'
    | 'catch_up_pending';

export function listEligibleSessionFollowSourceCandidates<T extends Readonly<{ id: string }>>(input: Readonly<{
    sessions: readonly T[];
    destination: Readonly<{ serverId: string; sessionId: string }>;
    existingSourceSessionIds: readonly string[];
    resolveServerId(sessionId: string): string | null;
}>): T[] {
    const existing = new Set(input.existingSourceSessionIds);
    return input.sessions.filter((session) => (
        session.id !== input.destination.sessionId
        && !existing.has(session.id)
        && input.resolveServerId(session.id) === input.destination.serverId
    ));
}

export function resolveSessionFollowSourceRuntimeState(input: Readonly<{
    deliveryState: SessionFollowSourceDeliveryStateV1;
    machine: Readonly<{
        kind?: 'persistent' | 'ephemeral_session_runner';
        active: boolean;
        activeAt?: number | null;
        revokedAt?: number | null;
        operationProtocolCapabilities?: unknown;
    }> | null;
    sourceEncryptionMode?: 'plain' | 'e2ee' | null;
    preparedInUiLifetime?: boolean;
    hasPendingUpdates?: boolean;
    mode?: SessionFollowSourceModeV1;
    nowMs?: number;
}>): SessionFollowSourceRuntimeState {
    if (input.deliveryState === 'paused_archived') return 'paused_archived';
    if (!input.machine || !isMachineOnline(input.machine, input.nowMs)) return 'waiting_for_runtime';
    if (!supportsMachineSessionFollowContextV1(input.machine.operationProtocolCapabilities)) return 'runtime_unsupported';
    if (input.mode === 'wake_on_human_change'
        && !supportsMachineSessionFollowWakeOnHumanChangeV1(input.machine.operationProtocolCapabilities)) {
        return 'runtime_unsupported';
    }
    if (
        !isPersistentMachine(input.machine)
        && input.sourceEncryptionMode !== 'plain'
        && input.preparedInUiLifetime !== true
    ) return 'waiting_for_source_key';
    if (input.hasPendingUpdates === true) return 'catch_up_pending';
    return 'eligible';
}

import { useShallow } from 'zustand/react/shallow';

import { normalizeSessionId } from '@/sync/domains/session/normalizeSessionId';
import {
    resolveMachineControlTargetForSessionFromState,
    resolveMachineTargetForSessionFromState,
    type SessionMachineControlTarget,
    type SessionMachineTargetState,
    type SessionMachineTargetIdentity,
} from '@/sync/domains/session/resolveMachineTargetForSessionFromState';
import { getStorage } from '@/sync/domains/state/storage';

export function useSessionMachineTarget(target: SessionMachineTargetIdentity | null, serverId?: string | null): { machineId: string; basePath: string } | null {
    const resolvedTarget = typeof target === 'string'
        ? serverId?.trim() ? { serverId: serverId.trim(), sessionId: normalizeSessionId(target) } : normalizeSessionId(target)
        : target;

    return getStorage()(
        useShallow((state) =>
            resolvedTarget === null ? null : resolveMachineTargetForSessionFromState(
                state as SessionMachineTargetState,
                resolvedTarget,
            ),
        ),
    );
}

export function useSessionMachineControlTarget(sessionId: string, serverId?: string | null): SessionMachineControlTarget | null {
    const resolvedSessionId = normalizeSessionId(sessionId);

    return getStorage()(
        useShallow((state) =>
            resolveMachineControlTargetForSessionFromState(
                state as SessionMachineTargetState,
                serverId?.trim() ? { serverId: serverId.trim(), sessionId: resolvedSessionId } : resolvedSessionId,
            ),
        ),
    );
}

import type { ActionOperationSnapshotV1 } from '@happier-dev/protocol';

import { isActionOperationTerminal, type ActionOperationObservation, type ActionOperationStoreSnapshot } from './actionOperationStore';
import {
    actionOperationAddressKey,
    actionOperationMachineAddressKey,
    actionOperationRequestAddressKey,
    actionOperationSessionAddressKey,
    normalizeActionOperationServerId,
    type ActionOperationAddress,
    type ActionOperationSessionAddress,
    type QualifiedActionOperation,
} from './qualifiedActionOperation';

export type ActionOperationProjection = Readonly<{
    serverId: string;
    snapshot: ActionOperationSnapshotV1;
    observation: ActionOperationObservation;
    isUnavailableProjection: boolean;
    followUpAttention?: string | null;
}>;

export type InboxActionOperationReason = 'failed' | 'status_unavailable' | 'setup_needs_attention';

export type InboxActionOperationEntry = Readonly<{
    operation: ActionOperationProjection;
    reason: InboxActionOperationReason;
}>;

export type ActionOperationSelectors = Readonly<{
    selectAll(state: ActionOperationStoreSnapshot): readonly ActionOperationProjection[];
    selectById(state: ActionOperationStoreSnapshot, address: ActionOperationAddress): ActionOperationProjection | null;
    selectSnapshotByRequestId(
        state: ActionOperationStoreSnapshot,
        requestId: string,
        serverId: string | null,
        accountId?: string | null,
    ): ActionOperationSnapshotV1 | null;
    selectActive(state: ActionOperationStoreSnapshot): readonly ActionOperationProjection[];
    selectForSession(state: ActionOperationStoreSnapshot, address: ActionOperationSessionAddress): readonly ActionOperationProjection[];
    selectInbox(state: ActionOperationStoreSnapshot): readonly InboxActionOperationEntry[];
    selectHasUnseenTerminal(state: ActionOperationStoreSnapshot): boolean;
    selectHasAttention(state: ActionOperationStoreSnapshot): boolean;
}>;

const EMPTY_OPERATIONS: readonly ActionOperationProjection[] = Object.freeze([]);
const EMPTY_INBOX_OPERATIONS: readonly InboxActionOperationEntry[] = Object.freeze([]);

function hasSameItems<T>(current: readonly T[], next: readonly T[]): boolean {
    return current.length === next.length && current.every((item, index) => item === next[index]);
}

function compareOperations(a: ActionOperationProjection, b: ActionOperationProjection): number {
    const aActive = !isActionOperationTerminal(a.snapshot.state);
    const bActive = !isActionOperationTerminal(b.snapshot.state);
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (aActive) return b.snapshot.createdAt - a.snapshot.createdAt;
    return (b.snapshot.settledAt ?? b.snapshot.createdAt) - (a.snapshot.settledAt ?? a.snapshot.createdAt);
}

function isUnseen(state: ActionOperationStoreSnapshot, operation: ActionOperationProjection): boolean {
    if (!isActionOperationTerminal(operation.snapshot.state)) return false;
    const key = actionOperationAddressKey({ serverId: operation.serverId, operationId: operation.snapshot.operationId });
    const seen = state.seenAtByOperationKey.get(key);
    return seen === undefined || operation.snapshot.revision > seen.revision;
}

function readFollowUpAttention(
    state: ActionOperationStoreSnapshot,
    operation: QualifiedActionOperation,
): string | null {
    const snapshot = operation.snapshot;
    return snapshot.requestId
        ? state.followUpAttentionByRequestKey.get(actionOperationRequestAddressKey({
            serverId: operation.serverId,
            accountId: snapshot.scope.accountId,
            requestId: snapshot.requestId,
        })) ?? null
        : null;
}

export function createActionOperationSelectors(): ActionOperationSelectors {
    let previousState: ActionOperationStoreSnapshot | null = null;
    let previousAll: readonly ActionOperationProjection[] = EMPTY_OPERATIONS;
    let previousActive: readonly ActionOperationProjection[] = EMPTY_OPERATIONS;
    let previousInbox: readonly InboxActionOperationEntry[] = EMPTY_INBOX_OPERATIONS;
    const projectionCache = new Map<string, ActionOperationProjection>();
    const sessionCache = new Map<string, readonly ActionOperationProjection[]>();

    const selectAll = (state: ActionOperationStoreSnapshot): readonly ActionOperationProjection[] => {
        if (state === previousState) return previousAll;
        const retainedKeys = new Set<string>();
        const next = Array.from(state.operationsByKey.entries())
            .filter(([key, operation]) => !(
                (operation.snapshot.state === 'succeeded'
                    && state.dismissedRecentOperationKeys.has(key)
                    && readFollowUpAttention(state, operation) === null)
                || (state.unavailableOperationKeys.has(key) && state.dismissedUnavailableOperationKeys.has(key))
            ))
            .map(([key, operation]) => {
                retainedKeys.add(key);
                const snapshot = operation.snapshot;
                const isUnavailableProjection = state.unavailableOperationKeys.has(key);
                const observation = isUnavailableProjection
                    ? 'unavailable'
                    : state.machineObservationByKey.get(actionOperationMachineAddressKey({
                        serverId: operation.serverId,
                        machineId: snapshot.scope.machineId,
                    })) ?? 'unavailable';
                const followUpAttention = readFollowUpAttention(state, operation);
                const cached = projectionCache.get(key);
                if (
                    cached?.snapshot === snapshot
                    && cached.serverId === operation.serverId
                    && cached.observation === observation
                    && cached.isUnavailableProjection === isUnavailableProjection
                    && cached.followUpAttention === followUpAttention
                ) return cached;
                const projection = Object.freeze({
                    serverId: operation.serverId,
                    snapshot,
                    observation,
                    isUnavailableProjection,
                    followUpAttention,
                });
                projectionCache.set(key, projection);
                return projection;
            })
            .sort(compareOperations);
        for (const key of projectionCache.keys()) {
            if (!retainedKeys.has(key)) projectionCache.delete(key);
        }
        const nextAll = next.length === 0
            ? EMPTY_OPERATIONS
            : hasSameItems(previousAll, next) ? previousAll : Object.freeze(next);
        const active = nextAll.filter((operation) => !isActionOperationTerminal(operation.snapshot.state));
        previousState = state;
        previousAll = nextAll;
        previousActive = active.length === 0
            ? EMPTY_OPERATIONS
            : hasSameItems(previousActive, active) ? previousActive : Object.freeze(active);
        return previousAll;
    };

    const selectById = (state: ActionOperationStoreSnapshot, address: ActionOperationAddress) => {
        const serverId = normalizeActionOperationServerId(address.serverId);
        if (!serverId) return null;
        selectAll(state);
        return projectionCache.get(actionOperationAddressKey({ ...address, serverId })) ?? null;
    };

    const selectSnapshotByRequestId = (
        state: ActionOperationStoreSnapshot,
        requestId: string,
        serverId: string | null,
        accountId?: string | null,
    ): ActionOperationSnapshotV1 | null => {
        const normalizedRequestId = requestId.trim();
        const normalizedServerId = normalizeActionOperationServerId(serverId);
        const normalizedAccountId = typeof accountId === 'string' ? accountId.trim() : '';
        if (!normalizedRequestId || !normalizedServerId) return null;
        let match: ActionOperationSnapshotV1 | null = null;
        for (const operation of state.operationsByKey.values()) {
            const snapshot = operation.snapshot;
            if (operation.serverId !== normalizedServerId || snapshot.requestId !== normalizedRequestId) continue;
            if (normalizedAccountId && snapshot.scope.accountId !== normalizedAccountId) continue;
            if (match) return null;
            match = snapshot;
        }
        return match;
    };

    const selectActive = (state: ActionOperationStoreSnapshot) => {
        selectAll(state);
        return previousActive;
    };

    const selectForSession = (state: ActionOperationStoreSnapshot, address: ActionOperationSessionAddress) => {
        const normalizedServerId = normalizeActionOperationServerId(address.serverId);
        if (!normalizedServerId) return EMPTY_OPERATIONS;
        const cacheKey = actionOperationSessionAddressKey({ serverId: normalizedServerId, sessionId: address.sessionId });
        const operations = selectAll(state).filter((operation) => (
            operation.serverId === normalizedServerId && operation.snapshot.scope.sessionId === address.sessionId
        ));
        const cached = sessionCache.get(cacheKey) ?? EMPTY_OPERATIONS;
        const stable = operations.length === 0
            ? EMPTY_OPERATIONS
            : hasSameItems(cached, operations) ? cached : Object.freeze(operations);
        sessionCache.set(cacheKey, stable);
        return stable;
    };

    const selectInbox = (state: ActionOperationStoreSnapshot): readonly InboxActionOperationEntry[] => {
        const next = selectAll(state).flatMap((operation): readonly InboxActionOperationEntry[] => {
            if (operation.snapshot.state === 'failed' && isUnseen(state, operation)) {
                return [{ operation, reason: 'failed' }];
            }
            if (
                operation.snapshot.state === 'succeeded'
                && operation.followUpAttention !== null
            ) {
                return [{ operation, reason: 'setup_needs_attention' }];
            }
            if (
                (operation.snapshot.state === 'accepted' || operation.snapshot.state === 'running')
                && operation.isUnavailableProjection
            ) {
                return [{ operation, reason: 'status_unavailable' }];
            }
            return [];
        });
        if (next.length === 0) {
            previousInbox = EMPTY_INBOX_OPERATIONS;
            return previousInbox;
        }
        if (
            previousInbox.length === next.length
            && previousInbox.every((entry, index) => (
                entry.operation === next[index]?.operation && entry.reason === next[index]?.reason
            ))
        ) return previousInbox;
        previousInbox = Object.freeze(next.map((entry) => Object.freeze(entry)));
        return previousInbox;
    };

    const selectHasUnseenTerminal = (state: ActionOperationStoreSnapshot) => selectAll(state).some((operation) => isUnseen(state, operation));
    const selectHasAttention = (state: ActionOperationStoreSnapshot) => (
        selectActive(state).length > 0
        || selectHasUnseenTerminal(state)
        || selectAll(state).some((operation) => operation.followUpAttention !== null)
    );

    return {
        selectAll,
        selectById,
        selectSnapshotByRequestId,
        selectActive,
        selectForSession,
        selectInbox,
        selectHasUnseenTerminal,
        selectHasAttention,
    };
}

export const actionOperationSelectors = createActionOperationSelectors();

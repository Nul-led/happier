import * as React from 'react';
import type { ExecutionRunPublicState } from '@happier-dev/protocol';

import { normalizeSessionId } from '@/sync/domains/session/normalizeSessionId';
import { normalizeSessionAddress } from '@/sync/domains/session/sessionAddress';
import { getActiveServerSnapshot, subscribeActiveServer } from '@/sync/domains/server/serverRuntime';
import { sessionExecutionRunList, type SessionExecutionRunListResult } from '@/sync/ops/sessionExecutionRuns';
import {
    readRunningExecutionRunRoster,
    refreshRunningExecutionRunRoster,
    subscribeRunningExecutionRunRoster,
} from '@/sync/runtime/executionRuns/executionRunActivityBus';

export function resolveRunningExecutionRunsFromListResult(
    result: SessionExecutionRunListResult,
): readonly ExecutionRunPublicState[] {
    if (!('runs' in result)) return [];
    return result.runs.filter((run) => run.status === 'running');
}

export function useSessionRunningExecutionRuns(params: Readonly<{
    sessionId: string;
    serverId?: string | null;
    enabled: boolean;
    refreshKey?: unknown;
}>): readonly ExecutionRunPublicState[] {
    // Legacy unqualified callers follow the existing active-Home owner. Never
    // share a roster by raw Session id, including while the Home is unavailable.
    const explicitServerId = params.serverId?.trim() || null;
    const subscribeServer = React.useCallback((listener: () => void) => (
        explicitServerId ? () => {} : subscribeActiveServer(listener)
    ), [explicitServerId]);
    const readServer = React.useCallback(() => explicitServerId ?? getActiveServerSnapshot().serverId, [explicitServerId]);
    const serverId = React.useSyncExternalStore(subscribeServer, readServer, readServer);
    const sessionId = normalizeSessionId(params.sessionId);
    const address = React.useMemo(
        () => params.enabled ? normalizeSessionAddress(serverId, sessionId) : null,
        [params.enabled, serverId, sessionId],
    );
    const subscribe = React.useCallback((listener: () => void) => {
        if (!address) return () => {};
        return subscribeRunningExecutionRunRoster(address, listener, async () => {
            const result = await sessionExecutionRunList(address.sessionId, {}, { serverId: address.serverId });
            return result.ok === false ? null : resolveRunningExecutionRunsFromListResult(result);
        });
    }, [address]);
    const read = React.useCallback(() => readRunningExecutionRunRoster(address), [address]);
    const runningRuns = React.useSyncExternalStore(subscribe, read, read);

    const previousRefresh = React.useRef({ address, key: params.refreshKey });
    React.useEffect(() => {
        const previous = previousRefresh.current;
        previousRefresh.current = { address, key: params.refreshKey };
        // A new address has already acquired its baseline in subscribe.
        if (!address || previous.address !== address || Object.is(previous.key, params.refreshKey)) return;
        refreshRunningExecutionRunRoster(address);
    }, [address, params.refreshKey]);

    return runningRuns;
}

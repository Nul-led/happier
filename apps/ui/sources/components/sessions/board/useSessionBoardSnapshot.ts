import * as React from 'react';

import { projectSessionBoard } from '@/sync/domains/session/board';
import { normalizeSessionAddress } from '@/sync/domains/session/sessionAddress';
import { useServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { normalizeSessionAccessProjection } from '@/sync/engine/sessions/normalizeSessionAccessProjection';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import { observeSessionBoard, type SessionBoardAuthority, type SessionBoardBinding } from './observeSessionBoard';

export type SessionBoardSnapshotBinding = SessionBoardBinding & Readonly<{ refresh: () => void }>;
export type SessionBoardSnapshotInput = Readonly<{
    serverId: string | null;
    sessionId: string;
    boardFeatureEnabled: boolean;
}>;

const LOADING: SessionBoardBinding = Object.freeze({ status: 'ready', snapshot: projectSessionBoard({
    layout: undefined, items: new Map(), capabilities: null, freshness: 'stale', reachability: 'unknown', loading: 'initial', incomplete: true,
}) });

/** The Board's single binding to exact-Home, Account-owned Session records. */
export function useSessionBoardSnapshot(input: SessionBoardSnapshotInput): SessionBoardSnapshotBinding {
    const address = React.useMemo(() => normalizeSessionAddress(input.serverId, input.sessionId), [input.serverId, input.sessionId]);
    const resolution = useServerCredentialAccountScopeResolution(address?.serverId);
    // Exact-Home credential resolution and repository retirement own this
    // observation lifetime. Focus changes are presentation, not authority.
    const lifetime = React.useMemo(() => ({ address, resolution }), [address, resolution]);
    const [retry, setRetry] = React.useState(0);
    const [observed, setObserved] = React.useState<Readonly<{
        lifetime: typeof lifetime;
        binding: SessionBoardBinding;
        isCurrent: () => boolean;
        refreshRecords?: () => void;
    }> | null>(null);

    React.useEffect(() => {
        if (!input.boardFeatureEnabled || !address || resolution.kind !== 'bound') return;
        let stopped = false;
        let unsubscribe: (() => void) | undefined;
        const sync = getSyncSingleton();
        const publish = (binding: SessionBoardBinding, isCurrent = () => !stopped, refreshRecords?: () => void) => {
            if (!stopped) setObserved({ lifetime, binding, isCurrent, refreshRecords });
        };
        void sync.withSessionSystemRecordRuntime(address, async runtime => {
            if (stopped) return;
            if (runtime.scope.accountId !== resolution.scope.accountId || !runtime.isCurrent()) {
                publish({ status: 'unavailable', reason: 'forbidden' });
                return;
            }
            const readCapabilities = (current: typeof runtime): SessionBoardAuthority['capabilities'] => {
                const session = current.readSession();
                if (!session) return null;
                return normalizeSessionAccessProjection({ effectiveAccess: session.effectiveAccess })?.capabilities ?? null;
            };
            const initialCapabilities = readCapabilities(runtime);
            if (!initialCapabilities) {
                publish({ status: 'unavailable', reason: 'forbidden' });
                return;
            }
            unsubscribe = observeSessionBoard({
                session: address,
                repository: runtime.repository,
                authority: { contentContext: runtime.contentContext, capabilities: initialCapabilities },
                readCapabilities: () => readCapabilities(runtime),
                readContentContext: runtime.readContentContext,
                isCurrent: () => !stopped && runtime.isCurrent(),
                renewAuthority: async () => {
                    const renewed = await sync.withSessionSystemRecordRuntime(address, async current => {
                        if (current.repository !== runtime.repository || current.scope.accountId !== runtime.scope.accountId) return null;
                        const capabilities = readCapabilities(current);
                        return capabilities ? { contentContext: current.readContentContext(), capabilities } : null;
                    }, { forceSessionRefresh: true });
                    if (renewed.status !== 'ok') return renewed;
                    return renewed.value ? { status: 'ok', value: renewed.value } : { status: 'forbidden' };
                },
                onChange: binding => publish(binding, runtime.isCurrent, () => runtime.repository.invalidate(address)),
            });
        }).then(result => {
            if (result.status !== 'ok') publish({ status: 'unavailable', reason: result.status });
        }).catch(() => publish({ status: 'unavailable', reason: 'offline' }));
        return () => { stopped = true; unsubscribe?.(); };
    }, [address, input.boardFeatureEnabled, lifetime, resolution, retry]);

    const refresh = React.useCallback(() => {
        if (observed?.lifetime === lifetime && observed.isCurrent() && observed.binding.status === 'ready' && observed.refreshRecords) {
            observed.refreshRecords();
        } else {
            setObserved(null);
            setRetry(value => value + 1);
        }
    }, [lifetime, observed]);

    if (!input.boardFeatureEnabled) return { status: 'unavailable', reason: 'board_feature_disabled', refresh };
    if (!address) return { status: 'unavailable', reason: 'invalid_address', refresh };
    if (resolution.kind !== 'bound') return resolution.kind === 'resolving' ? { ...LOADING, refresh } : { status: 'unavailable', reason: resolution.kind, refresh };
    if (observed?.lifetime !== lifetime) return { ...LOADING, refresh };
    if (!observed.isCurrent()) return { status: 'unavailable', reason: 'forbidden', refresh };
    return { ...observed.binding, refresh };
}

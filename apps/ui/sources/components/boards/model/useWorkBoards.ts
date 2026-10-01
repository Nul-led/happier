import * as React from 'react';
import { WORK_BOARDS_ACCOUNT_KV_KEY_V1, type WorkBoardIntentV1, type WorkBoardV1, type WorkBoardsV1 } from '@happier-dev/protocol';
import { useOptionalAuth } from '@/auth/context/AuthContext';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useActiveServerAccountScope, useIsDataReady } from '@/sync/domains/state/storage';
import { captureActiveServerAccountScopeLifetime, type ActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { getActiveServerHomeCarrier, getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { createServerFetchAtEndpoint } from '@/sync/http/client';
import { createAccountKvJsonTransport } from '@/sync/ops/account/accountKvJsonTransport';
import { subscribeKvPrefixChanges } from '@/sync/engine/socket/kvUpdateDispatcher';
import { apiSocket } from '@/sync/api/session/apiSocket';
import { InvalidateSync } from '@/utils/sessions/sync';
import { parseToken } from '@/utils/auth/parseToken';
import { createWorkBoardAccountStore } from './workBoardAccountStore';
import { projectDisplayedWorkBoards, type WorkBoardSaveQueue, type WorkBoardSaveState } from './workBoardSaveQueue';

type MountedBoards = ReturnType<typeof createWorkBoardAccountStore> & Readonly<{ retain(): () => void; isCurrent(): boolean }>;
const stores = new WeakMap<ActiveServerAccountScopeLifetime, WeakMap<AuthCredentials, MountedBoards>>();
const unavailable = createWorkBoardAccountStore({
    read: async () => { throw new Error('Board Account unavailable'); },
    compareAndSet: async () => { throw new Error('Board Account unavailable'); },
}, () => false);

/** All mounted Board surfaces share one projection/queue in the canonical active Account lifetime. */
function useBoardStore() {
    const credentials = useOptionalAuth()?.credentials ?? null;
    const scope = useActiveServerAccountScope();
    const ready = useIsDataReady();
    const server = useActiveServerSnapshot(credentials !== null);
    const lifetime = captureActiveServerAccountScopeLifetime();
    let store: MountedBoards | typeof unavailable = unavailable;
    let accountId: string | null = null;
    try { if (credentials) accountId = parseToken(credentials.token); } catch { /* No Account identity can be established. */ }
    if (ready && credentials && scope && lifetime && accountId === scope.accountId
        && scope.serverId === server.serverId && server.serverUrl) {
        let byCredentials = stores.get(lifetime);
        if (!byCredentials) { byCredentials = new WeakMap(); stores.set(lifetime, byCredentials); }
        let mounted = byCredentials.get(credentials);
        if (!mounted || !mounted.isCurrent()) {
            const capturedCredentials = credentials;
            const carrier = getActiveServerHomeCarrier();
            const shouldContinue = () => {
                const current = getActiveServerSnapshot();
                return lifetime.isCurrent() && current.serverId === server.serverId
                    && current.generation === server.generation && current.serverUrl === server.serverUrl
                    && current.runtimeOrigin === server.runtimeOrigin && current.carrier === server.carrier
                    && getActiveServerHomeCarrier() === carrier;
            };
            const request = createServerFetchAtEndpoint({ endpointUrl: server.serverUrl, serverId: server.serverId,
                ...(server.runtimeOrigin ? { runtimeOrigin: server.runtimeOrigin } : {}),
                ...(carrier ? { homeCarrier: carrier } : {}), credentials: capturedCredentials, isCurrent: shouldContinue });
            const domain = createWorkBoardAccountStore(createAccountKvJsonTransport({
                key: WORK_BOARDS_ACCOUNT_KV_KEY_V1, credentials: capturedCredentials, request, shouldContinue,
            }), shouldContinue);
            lifetime.onRetire(domain.retire);
            mounted = { ...domain, isCurrent: shouldContinue, retain() {
                return domain.retainView(() => {
                    const sync = new InvalidateSync(async () => { if (shouldContinue()) await domain.refresh(); });
                    const refresh = () => { if (shouldContinue()) sync.invalidate(); };
                    const unsubscribeKv = subscribeKvPrefixChanges(WORK_BOARDS_ACCOUNT_KV_KEY_V1, changes => {
                        if (changes.some(change => change.key === WORK_BOARDS_ACCOUNT_KV_KEY_V1)) refresh();
                    }, { credentials: capturedCredentials, shouldContinue });
                    const unsubscribeReconnect = apiSocket.onReconnected(refresh);
                    refresh();
                    return () => { sync.stop(); unsubscribeKv(); unsubscribeReconnect(); };
                });
            } };
            byCredentials.set(credentials, mounted);
        }
        store = mounted;
    }
    React.useEffect(() => 'retain' in store ? store.retain() : undefined, [store]);
    return store;
}

export function useWorkBoardSaveQueue(): WorkBoardSaveQueue { return useBoardStore().queue; }

export function useWorkBoardReadState() {
    const store = useBoardStore();
    const state = React.useSyncExternalStore(store.subscribe, store.getReadState, store.getReadState);
    return { ...state, retry: store.refresh };
}

export function useWorkBoardSaveState(): WorkBoardSaveState {
    const queue = useWorkBoardSaveQueue();
    return React.useSyncExternalStore(queue.subscribe, queue.getState, queue.getState);
}

export function useWorkBoards(): WorkBoardsV1 {
    const store = useBoardStore();
    const acknowledged = React.useSyncExternalStore(store.subscribe, store.getBoards, store.getBoards);
    const { pending } = React.useSyncExternalStore(store.queue.subscribe, store.queue.getState, store.queue.getState);
    return React.useMemo(() => pending.length === 0 ? acknowledged : projectDisplayedWorkBoards(acknowledged, pending), [acknowledged, pending]);
}

export function useWorkBoard(boardId: string | null): WorkBoardV1 | null {
    const boards = useWorkBoards();
    return boardId ? boards.boards.find(board => board.id === boardId) ?? null : null;
}

export function useDispatchWorkBoardIntent(): (intent: WorkBoardIntentV1) => Promise<void> {
    return useWorkBoardSaveQueue().dispatch;
}

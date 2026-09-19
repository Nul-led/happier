import { EXPLICIT_SESSION_UNFOLLOW_STATE_V1 } from '@happier-dev/protocol';
import type {
    GetSessionFollowResponse,
    RemoveSessionFollowResponse,
    SessionFollowErrorCodeV1,
    SetSessionFollowRequest,
    SetSessionFollowResponse,
} from '@happier-dev/protocol';

import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

export type FollowTransportResult<T> =
    | Readonly<{ kind: 'ok'; value: T }>
    | Readonly<{ kind: 'failed'; error: SessionFollowErrorCodeV1 | 'unavailable' }>;

export type AccountSessionFollowTransport = Readonly<{
    get(address: SessionAddress): Promise<FollowTransportResult<GetSessionFollowResponse>>;
    set(address: SessionAddress, preferences: SetSessionFollowRequest): Promise<FollowTransportResult<SetSessionFollowResponse>>;
    remove(address: SessionAddress): Promise<FollowTransportResult<RemoveSessionFollowResponse>>;
}>;

export type AccountSessionFollowEditorSnapshot = Readonly<{
    projection: GetSessionFollowResponse | null;
    /** An uncommitted form selection. Never publishes Follow interest or read state. */
    draft: SetSessionFollowRequest | null;
    loading: boolean;
    saving: boolean;
    online: boolean;
    error: SessionFollowErrorCodeV1 | 'unavailable' | null;
    /** Feedback for this editor's explicit enable interaction, not a delivery acknowledgement. */
    voiceInitialSnapshotPending: boolean;
}>;

/**
 * One editor lifetime over the canonical Home projection. All hosts use this
 * controller; none stores a second durable Follow choice. The injected boundary
 * is HTTP, so request/retry/race tests retain the actual state transitions.
 */
export function createAccountSessionFollowController(
    address: SessionAddress,
    transport: AccountSessionFollowTransport,
) {
    const target = Object.freeze({ ...address });
    let snapshot: AccountSessionFollowEditorSnapshot = Object.freeze({
        projection: null,
        draft: null,
        loading: false,
        saving: false,
        online: true,
        error: null,
        voiceInitialSnapshotPending: false,
    });
    const listeners = new Set<() => void>();
    let disposed = false;
    let activeRead: object | null = null;
    let refreshAfterSave = false;
    let retryOperation: 'load' | 'set' | 'remove' = 'load';

    function update(patch: Partial<AccountSessionFollowEditorSnapshot>) {
        if (disposed) return;
        snapshot = Object.freeze({ ...snapshot, ...patch });
        for (const listener of listeners) listener();
    }

    function failed(error: SessionFollowErrorCodeV1 | 'unavailable') {
        const accessLost = error === 'session_not_found' || error === 'account_inactive' || error === 'feature_unavailable';
        if (accessLost) retryOperation = 'load';
        update({
            error,
            loading: false,
            saving: false,
            ...(accessLost ? { projection: null, draft: null, voiceInitialSnapshotPending: false } : {}),
        });
    }

    async function refresh(): Promise<void> {
        if (disposed || !snapshot.online) return;
        if (snapshot.saving) {
            refreshAfterSave = true;
            return;
        }
        const read = {};
        activeRead = read;
        const mutationRetryPending = retryOperation !== 'load' && snapshot.error !== null;
        update({ loading: true, error: mutationRetryPending ? snapshot.error : null });
        try {
            const result = await transport.get(target);
            if (disposed || activeRead !== read) return;
            activeRead = null;
            if (result.kind === 'failed') {
                if (!mutationRetryPending) retryOperation = 'load';
                failed(result.error);
                return;
            }
            update({
                projection: result.value,
                loading: false,
                voiceInitialSnapshotPending: result.value.voiceInitialSnapshotPending,
            });
        } catch {
            if (disposed || activeRead !== read) return;
            activeRead = null;
            if (!mutationRetryPending) retryOperation = 'load';
            failed('unavailable');
        }
    }

    async function finishSave() {
        if (!refreshAfterSave || disposed) return;
        refreshAfterSave = false;
        await refresh();
    }

    async function set(preferences: SetSessionFollowRequest): Promise<void> {
        if (disposed || !snapshot.online || snapshot.saving || snapshot.projection?.capabilities.manageFollow !== true) return;
        activeRead = null;
        retryOperation = 'set';
        update({ draft: { ...preferences }, saving: true, loading: false, error: null });
        try {
            const result = await transport.set(target, preferences);
            if (disposed) return;
            if (result.kind === 'failed') {
                failed(result.error);
                return;
            }
            update({
                projection: {
                    follow: result.value.follow,
                    isSessionOwner: snapshot.projection?.isSessionOwner === true,
                    capabilities: { manageFollow: true },
                    voiceInitialSnapshotPending: result.value.voiceInitialSnapshotPending,
                },
                draft: null,
                saving: false,
                voiceInitialSnapshotPending: result.value.voiceInitialSnapshotPending,
            });
        } catch {
            failed('unavailable');
        } finally {
            await finishSave();
        }
    }

    async function remove(): Promise<void> {
        if (disposed || !snapshot.online || snapshot.saving || !snapshot.projection) return;
        activeRead = null;
        retryOperation = 'remove';
        update({ saving: true, loading: false, error: null, draft: null });
        try {
            const result = await transport.remove(target);
            if (disposed) return;
            if (result.kind === 'failed') {
                failed(result.error);
                return;
            }
            update({
                projection: {
                    follow: { sessionId: target.sessionId, ...EXPLICIT_SESSION_UNFOLLOW_STATE_V1 },
                    isSessionOwner: snapshot.projection?.isSessionOwner === true,
                    capabilities: snapshot.projection?.capabilities ?? { manageFollow: false },
                    voiceInitialSnapshotPending: false,
                },
                saving: false,
                voiceInitialSnapshotPending: false,
            });
        } catch {
            failed('unavailable');
        } finally {
            await finishSave();
        }
    }

    return {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        refresh,
        set,
        remove,
        retry: async () => {
            if (retryOperation === 'set' && snapshot.draft) await set(snapshot.draft);
            else if (retryOperation === 'remove') await remove();
            else await refresh();
        },
        setOnline(online: boolean) {
            if (online !== snapshot.online) update({ online });
        },
        dispose() {
            disposed = true;
            activeRead = null;
            listeners.clear();
        },
    };
}

export type AccountSessionFollowController = ReturnType<typeof createAccountSessionFollowController>;

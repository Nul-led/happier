import * as React from 'react';

import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { sessionAddressKey } from '@/sync/domains/session/sessionAddress';
import type { Session } from '@/sync/domains/state/storageTypes';
import { useSessionListRenderableWithServerScope } from '@/sync/store/hooks';
import {
    runWithServerRequestAuthorityForServerAccountScope,
} from '@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope';
import {
    readSessionSnapshotForAuthority,
    SessionSnapshotReadError,
} from '@/sync/runtime/orchestration/serverScopedRpc/readSessionSnapshotForAuthority';

type ExactSessionSnapshot = Omit<Session, 'presence'> & { presence?: 'online' | number };

export type ExactSessionSnapshotState =
    | Readonly<{ key: string; kind: 'loading'; session: null; retry: () => void }>
    | Readonly<{ key: string; kind: 'ready'; session: ExactSessionSnapshot; retry: () => void }>
    | Readonly<{
        key: string;
        kind: 'authorization_lost' | 'unsupported' | 'unavailable';
        session: null;
        retry: () => void;
    }>;

const noActiveRequest = async (): Promise<Response> => {
    throw new Error('Expected an exact Account request');
};

function classifySnapshotFailure(error: unknown): Exclude<ExactSessionSnapshotState['kind'], 'loading' | 'ready'> {
    if (!(error instanceof SessionSnapshotReadError)) return 'unavailable';
    if (error.errorCode === 'unauthorized' || error.errorCode === 'forbidden' || error.errorCode === 'not_found') {
        return 'authorization_lost';
    }
    if (error.errorCode === 'invalid_response' || error.httpStatus === 404) return 'unsupported';
    return 'unavailable';
}

/**
 * Ephemeral exact-Home read for UI that needs the full Session projection.
 * The canonical scoped reader owns transport, decryption, and compatibility;
 * this hook owns only React lifetime, canonical invalidation and explicit retry.
 * It deliberately does not publish into or fall back to the active Home's
 * global Session store.
 *
 * Invalidation reuses the canonical Home-scoped Session row the concurrent
 * Session cache already maintains for this exact address, so a Session fact
 * that changes while the surface is open (a completed materialization, an
 * access change) re-reads without a remount. A row for the same raw Session id
 * on a different Home cannot reach this reader: the subscription is keyed by
 * the scope's own `serverId`.
 */
export function useExactSessionSnapshot(
    scope: ServerAccountScope,
    sessionId: string,
): ExactSessionSnapshotState {
    const key = JSON.stringify([
        serverAccountScopeKeySuffix(scope),
        sessionAddressKey({ serverId: scope.serverId, sessionId }),
    ]);
    const [revision, setRevision] = React.useState(0);
    const [state, setState] = React.useState<Readonly<{
        key: string;
        kind: ExactSessionSnapshotState['kind'];
        session: ExactSessionSnapshot | null;
    }>>({ key, kind: 'loading', session: null });
    const retry = React.useCallback(() => setRevision((value) => value + 1), []);
    const canonicalRow = useSessionListRenderableWithServerScope(scope.serverId, sessionId);
    // The durable facts this reader projects all advance the Home-scoped row's
    // own currentness; the composite is the invalidation signal, not data.
    const canonicalRevision = canonicalRow
        ? `${canonicalRow.seq}:${canonicalRow.updatedAt}:${canonicalRow.metadataVersion}`
        : '';

    React.useEffect(() => {
        let current = true;
        // A canonical invalidation refreshes an already-ready projection in
        // place; blanking it would replace the open panel with a spinner for
        // every Session change the surface is watching.
        setState((previous) => (previous.key === key && previous.kind === 'ready'
            ? previous
            : { key, kind: 'loading', session: null }));
        void runWithServerRequestAuthorityForServerAccountScope(
            { scope, activeRequest: noActiveRequest },
            async (authority) => await readSessionSnapshotForAuthority({
                authority,
                sessionId,
                isCurrent: () => current,
            }),
        ).then(
            (snapshot) => {
                if (current) setState({ key, kind: 'ready', session: snapshot.session });
            },
            (error: unknown) => {
                if (current) setState({ key, kind: classifySnapshotFailure(error), session: null });
            },
        );
        return () => { current = false; };
    }, [canonicalRevision, key, revision, scope.accountId, scope.serverId, sessionId]);

    if (state.key !== key) return { key, kind: 'loading', session: null, retry };
    if (state.kind === 'ready' && state.session) return { key, kind: 'ready', session: state.session, retry };
    return { key, kind: state.kind === 'ready' ? 'unavailable' : state.kind, session: null, retry };
}

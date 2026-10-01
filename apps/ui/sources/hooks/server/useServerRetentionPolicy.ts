import * as React from 'react';

import {
    getCachedServerRetentionPolicy,
    getServerRetentionPolicy,
} from '@/sync/api/capabilities/serverRetentionPolicyClient';
import type { ServerRetentionPolicyView } from '@/sync/domains/server/retention/serverRetentionPolicy';

/**
 * A Home's retention policy as a reader shows it: `loading` until the policy answers (never a
 * partial verdict meanwhile), `failed` with a retry when it could not be read.
 */
export type ServerRetentionPolicyState =
    | Readonly<{ status: 'loading' }>
    | Readonly<{ status: 'ready'; policy: ServerRetentionPolicyView }>
    | Readonly<{ status: 'failed'; retry: () => void }>;

const LOADING: ServerRetentionPolicyState = { status: 'loading' };

function cachedState(serverId: string): ServerRetentionPolicyState {
    const cached = serverId ? getCachedServerRetentionPolicy(serverId) : null;
    return cached ? { status: 'ready', policy: cached } : LOADING;
}

export function useServerRetentionPolicy(serverId?: string | null): ServerRetentionPolicyState {
    const normalizedServerId = String(serverId ?? '').trim();
    const [state, setState] = React.useState<ServerRetentionPolicyState>(() => cachedState(normalizedServerId));
    const [attempt, setAttempt] = React.useState(0);
    const retry = React.useCallback(() => setAttempt((current) => current + 1), []);

    React.useEffect(() => {
        if (!normalizedServerId) {
            setState(LOADING);
            return;
        }
        let active = true;
        setState(cachedState(normalizedServerId));
        void getServerRetentionPolicy({ serverId: normalizedServerId, force: attempt > 0 }).then((read) => {
            if (!active) return;
            setState(read.status === 'ready' ? { status: 'ready', policy: read.policy } : { status: 'failed', retry });
        });
        return () => {
            active = false;
        };
    }, [attempt, normalizedServerId, retry]);

    return state;
}

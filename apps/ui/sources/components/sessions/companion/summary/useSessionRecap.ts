import * as React from 'react';
import type { SessionSynopsisV1 } from '@happier-dev/protocol';

import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import { observeSessionSynopses } from '@/sync/ops/sessionSynopsis';

import { resolveSessionRecap, type SessionRecap } from './sessionRecap';

const NO_SYNOPSES: readonly SessionSynopsisV1[] = Object.freeze([]);

/**
 * The Recap for the Summary card: the memory worker's latest synopsis, observed through the shared
 * System Record repository while the card is mounted. The worker-update fallback reads the delivered
 * `WorkerUpdate` headline once that transcript event exists (ORC U6); until then only the synopsis
 * can produce a Recap.
 */
export function useSessionRecap(address: SessionAddress | null): SessionRecap | null {
    const [synopses, setSynopses] = React.useState<readonly SessionSynopsisV1[]>(NO_SYNOPSES);
    const serverId = address?.serverId ?? null;
    const sessionId = address?.sessionId ?? null;
    React.useEffect(() => {
        setSynopses(NO_SYNOPSES);
        if (!serverId || !sessionId) return;
        return observeSessionSynopses({
            session: { serverId, sessionId },
            onChange: (next) => setSynopses(next.length === 0 ? NO_SYNOPSES : next),
        });
    }, [serverId, sessionId]);
    return React.useMemo(
        () => resolveSessionRecap({ synopses, latestWorkerUpdate: null }),
        [synopses],
    );
}

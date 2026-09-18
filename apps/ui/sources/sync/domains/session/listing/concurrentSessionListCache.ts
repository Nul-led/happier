import type { SessionListHomeObservation } from './sessionListHomeObservation';

export type ConcurrentSessionListCacheEntry = Readonly<{
    serverName: string | null;
    /**
     * The one raw list-currentness fact this Home established: the phase its ordinary list
     * lifecycle is in, plus the time of its last successful list observation. It is published only
     * on a real transition, so a Home that keeps refreshing successfully does not churn state.
     */
    listObservation?: SessionListHomeObservation | null;
}>;

export type ConcurrentSessionListCacheByServerId = Readonly<
    Record<string, ConcurrentSessionListCacheEntry | null | undefined>
>;

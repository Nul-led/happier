import * as React from 'react';

import type {
    SessionDiscussionRepository,
    SessionDiscussionRepositorySnapshot,
} from './sessionDiscussionRepository';

/** The single React projection seam for the shared exact-Session Discussion repository. */
export function useSessionDiscussionRepositorySnapshot(
    repository: SessionDiscussionRepository,
): SessionDiscussionRepositorySnapshot {
    return React.useSyncExternalStore(
        repository.subscribe,
        repository.getSnapshot,
        repository.getSnapshot,
    );
}

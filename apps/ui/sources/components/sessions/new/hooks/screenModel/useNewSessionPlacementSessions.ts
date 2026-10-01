import * as React from 'react';

import { storage } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { StorageState } from '@/sync/store/types';

/**
 * The sessions New Session reads for placement (recent folders per machine, a machine's best
 * folder). Placement only uses where a session ran — its identity, Home and metadata — so this
 * keeps the previous array while those are unchanged. Activity rewrites the session record many
 * times a minute (status, thinking, timestamps); an always-mounted composer (Home) must not
 * re-render its whole model for each of those. Recency ordering is read from the kept entries and
 * refreshes with the next placement-relevant change.
 */
function samePlacementFacts(left: Session, right: Session): boolean {
    return left === right || (
        left.id === right.id
        && left.serverId === right.serverId
        && left.createdAt === right.createdAt
        && left.metadata === right.metadata
        && left.metadataLayoutVersion === right.metadataLayoutVersion
        && left.ownerMetadataView === right.ownerMetadataView
    );
}

export function useNewSessionPlacementSessions(): Session[] | null {
    const selector = React.useMemo(() => {
        let previousRecord: StorageState['sessions'] | null = null;
        let previous: Session[] | null = null;
        return (state: StorageState): Session[] | null => {
            if (!state.isDataReady) {
                previousRecord = null;
                previous = null;
                return null;
            }
            if (state.sessions === previousRecord && previous) return previous;
            previousRecord = state.sessions;
            const next = Object.values(state.sessions);
            if (previous && previous.length === next.length && next.every((session, index) => samePlacementFacts(previous![index]!, session))) {
                return previous;
            }
            previous = next;
            return previous;
        };
    }, []);
    return storage(selector);
}

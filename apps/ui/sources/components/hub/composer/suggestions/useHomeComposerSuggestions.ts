import * as React from 'react';

import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { readSessionListRowsForServerId } from '@/sync/domains/session/listing/sessionListRowStateLookup';
import { storage } from '@/sync/domains/state/storage';
import type { StorageState } from '@/sync/store/types';

import {
    deriveHomeComposerSuggestions,
    type HomeComposerSuggestion,
    type HomeComposerSuggestionSession,
} from './homeComposerSuggestions';

const NO_SUGGESTIONS: readonly HomeComposerSuggestion[] = Object.freeze([]);

function suggestionSignature(suggestions: readonly HomeComposerSuggestion[]): string {
    return suggestions.map((suggestion) => [
        suggestion.id,
        suggestion.sessionCount,
        suggestion.since.kind,
        new Date(suggestion.since.atMs).toDateString(),
    ].join('\u0000')).join('\u0001');
}

/**
 * Home's composer suggestions from the session list owner (the focused Home's list rows, the
 * same rows the sidebar renders). Derived only when those rows change, and the previous array is
 * kept while nothing a card shows changed, so session activity (which rewrites rows constantly)
 * does not re-render the cards.
 */
export function useHomeComposerSuggestions(): readonly HomeComposerSuggestion[] {
    const activeServerId = useActiveServerSnapshot().serverId ?? null;
    const selector = React.useMemo(() => {
        let previousRows: ReturnType<typeof readSessionListRowsForServerId> | undefined;
        let previous: readonly HomeComposerSuggestion[] = NO_SUGGESTIONS;
        let previousSignature = '';
        return (state: StorageState): readonly HomeComposerSuggestion[] => {
            if (!state.isDataReady) return NO_SUGGESTIONS;
            const rows = readSessionListRowsForServerId(state.sessionListRowsByServerId, activeServerId);
            if (rows === previousRows) return previous;
            previousRows = rows;
            const sessions: HomeComposerSuggestionSession[] = Object.values(rows ?? {}).map((row) => ({
                id: row.id,
                serverId: activeServerId ?? undefined,
                createdAt: row.createdAt,
                metadata: row.metadata,
            }));
            const next = deriveHomeComposerSuggestions({ sessions, nowMs: Date.now() });
            const signature = suggestionSignature(next);
            if (signature !== previousSignature) {
                previousSignature = signature;
                previous = next.length === 0 ? NO_SUGGESTIONS : next;
            }
            return previous;
        };
    }, [activeServerId]);
    return storage(selector);
}

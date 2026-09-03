import * as React from 'react';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';

type RetainedSessionListHeaderFilters = {
    searchQuery: string;
    selectedTags: string[];
};

type SessionListHeaderFilterState = RetainedSessionListHeaderFilters & {
    retentionKey: string;
};

const retainedHeaderFiltersByKey = new Map<string, RetainedSessionListHeaderFilters>();

export function clearSessionListHeaderFilterRetentionForTests(): void {
    retainedHeaderFiltersByKey.clear();
}

function getRetainedHeaderFilters(retentionKey: string): RetainedSessionListHeaderFilters {
    const existing = retainedHeaderFiltersByKey.get(retentionKey);
    if (existing) return existing;
    const entry: RetainedSessionListHeaderFilters = {
        searchQuery: '',
        selectedTags: [],
    };
    retainedHeaderFiltersByKey.set(retentionKey, entry);
    return entry;
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
}

export function useSessionListHeaderFilterRetention(retentionKey: string): Readonly<{
    searchQuery: string;
    setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
    selectedHeaderTags: string[];
    setSelectedHeaderTags: React.Dispatch<React.SetStateAction<string[]>>;
}> {
    const retainedFilters = React.useMemo(
        () => getRetainedHeaderFilters(retentionKey),
        [retentionKey],
    );
    const [state, setState] = React.useState<SessionListHeaderFilterState>(() => ({
        retentionKey,
        searchQuery: retainedFilters.searchQuery,
        selectedTags: retainedFilters.selectedTags,
    }));
    React.useEffect(() => {
        // Retention is useful across a route remount inside one Account lifetime,
        // but private query/tag state must not survive that Account's retirement.
        // Keep this callback registered after unmount so an inactive route entry is
        // retired with its owning Account rather than becoming restorable later.
        const lifetime = captureActiveServerAccountScopeLifetime();
        lifetime?.onRetire(() => {
            if (retainedHeaderFiltersByKey.get(retentionKey) === retainedFilters) {
                retainedHeaderFiltersByKey.delete(retentionKey);
            }
        });
    }, [retainedFilters, retentionKey]);
    let currentState = state;
    if (state.retentionKey !== retentionKey) {
        // A provider/Home/machine/list-scope transition retires the prior query
        // instead of keeping a restorable private value for an obsolete owner.
        retainedHeaderFiltersByKey.delete(state.retentionKey);
        currentState = {
            retentionKey,
            searchQuery: retainedFilters.searchQuery,
            selectedTags: retainedFilters.selectedTags,
        };
        setState(currentState);
    }

    const setSearchQuery = React.useCallback<React.Dispatch<React.SetStateAction<string>>>((value) => {
        setState((current) => {
            const currentQuery = current.retentionKey === retentionKey
                ? current.searchQuery
                : retainedFilters.searchQuery;
            const next = typeof value === 'function'
                ? (value as (previous: string) => string)(currentQuery)
                : value;
            retainedFilters.searchQuery = next;
            return {
                retentionKey,
                searchQuery: next,
                selectedTags: current.retentionKey === retentionKey
                    ? current.selectedTags
                    : retainedFilters.selectedTags,
            };
        });
    }, [retainedFilters, retentionKey]);

    const setSelectedHeaderTags = React.useCallback<React.Dispatch<React.SetStateAction<string[]>>>((value) => {
        setState((current) => {
            const currentTags = current.retentionKey === retentionKey
                ? current.selectedTags
                : retainedFilters.selectedTags;
            const next = typeof value === 'function'
                ? (value as (previous: string[]) => string[])(currentTags)
                : value;
            if (!stringArraysEqual(retainedFilters.selectedTags, next)) {
                retainedFilters.selectedTags = [...next];
            }
            return {
                retentionKey,
                searchQuery: current.retentionKey === retentionKey
                    ? current.searchQuery
                    : retainedFilters.searchQuery,
                selectedTags: next,
            };
        });
    }, [retainedFilters, retentionKey]);

    return React.useMemo(() => ({
        searchQuery: currentState.searchQuery,
        setSearchQuery,
        selectedHeaderTags: currentState.selectedTags,
        setSelectedHeaderTags,
    }), [currentState.searchQuery, currentState.selectedTags, setSearchQuery, setSelectedHeaderTags]);
}

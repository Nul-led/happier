import * as React from 'react';
import { useServerCredentialAccountScopeBindings } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';
import { readRegisteredSessionDiscussionRepository, subscribeRegisteredSessionDiscussionRepository } from './sessionDiscussionRepositoryRegistry';

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

/** Narrow, non-fetching title projection for every strip; message/read-state updates retain its identity. */
export function useSessionDiscussionTitleProjections(addresses: readonly Readonly<{
    serverId: string | null;
    sessionId: string;
    discussionId: string;
}>[]): readonly (string | null)[] {
    const serverIds = React.useMemo(() => addresses.map(address => address.serverId), [addresses]);
    const bindings = useServerCredentialAccountScopeBindings(serverIds);
    const source = React.useMemo(() => {
        const entries = addresses.map(address => {
            const serverId = resolveServerProfileScopeIdForIdentifier(address.serverId);
            return { ...address, serverId, binding: bindings.get(serverId) };
        });
        let titles: readonly (string | null)[] = [];
        const read = () => {
            const next = entries.map(entry => {
                if (!entry.binding?.isCurrent()) return null;
                const snapshot = readRegisteredSessionDiscussionRepository(entry.binding.scope, entry)?.getSnapshot();
                const summary = snapshot?.lists.active.items.find(row => row.id === entry.discussionId)
                    ?? snapshot?.lists.archived.items.find(row => row.id === entry.discussionId)
                    ?? snapshot?.threads[entry.discussionId]?.summary;
                return summary?.title ?? null;
            });
            if (next.length !== titles.length || next.some((title, index) => title !== titles[index])) titles = next;
            return titles;
        };
        return { read, subscribe: (listener: () => void) => {
            const subscribed = new Set<string>();
            const disposals: Array<() => void> = [];
            for (const entry of entries) {
                if (!entry.binding?.isCurrent()) continue;
                const key = JSON.stringify([entry.serverId, entry.binding.accountId, entry.sessionId]);
                if (subscribed.has(key)) continue;
                subscribed.add(key);
                disposals.push(subscribeRegisteredSessionDiscussionRepository(entry.binding.scope, entry, listener));
                const retirement = entry.binding.onRetire(listener);
                disposals.push(() => retirement.dispose());
            }
            return () => { for (const dispose of disposals) dispose(); };
        } };
    }, [addresses, bindings]);
    return React.useSyncExternalStore(source.subscribe, source.read, source.read);
}

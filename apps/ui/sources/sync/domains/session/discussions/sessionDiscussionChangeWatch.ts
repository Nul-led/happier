import type { ApiChangeEntry } from '@/sync/api/types/apiTypes';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

export type MountedSessionDiscussionChangeWatch = Readonly<{
    dispose(): void;
}>;

type ActiveWatch = Readonly<{
    address: SessionAddress;
    onInvalidated(): void;
}>;

const activeWatches = new Set<ActiveWatch>();

/**
 * Observe the incumbent AccountChange catch-up for one mounted Discussion
 * surface. This opens no socket and owns no cursor or cached data: it only asks
 * the mounted repository/controller to reread canonical HTTP state.
 */
export function watchMountedSessionDiscussions(input: Readonly<{
    address: SessionAddress;
    onInvalidated(): void;
}>): MountedSessionDiscussionChangeWatch {
    const watch: ActiveWatch = Object.freeze({
        address: Object.freeze({ ...input.address }),
        onInvalidated: input.onInvalidated,
    });
    activeWatches.add(watch);
    let disposed = false;
    return Object.freeze({
        dispose(): void {
            if (disposed) return;
            disposed = true;
            activeWatches.delete(watch);
        },
    });
}

/**
 * Called by the one changes-page application path before checkpointing. Hints
 * are deliberately ignored for correctness because Session AccountChange rows
 * coalesce and another Session mutation may replace a Discussion hint.
 */
export function publishMountedSessionDiscussionChanges(input: Readonly<{
    serverId: string;
    changes: readonly ApiChangeEntry[];
}>): void {
    if (activeWatches.size === 0) return;
    const changedSessionIds = new Set(
        input.changes
            .filter((change) => change.kind === 'session')
            .map((change) => change.entityId),
    );
    if (changedSessionIds.size === 0) return;

    for (const watch of [...activeWatches]) {
        if (
            !changedSessionIds.has(watch.address.sessionId)
            || !areServerProfileIdentifiersEquivalent(input.serverId, watch.address.serverId)
        ) {
            continue;
        }
        try {
            watch.onInvalidated();
        } catch {
            // A presentation refresh cannot suppress sibling observers or the
            // AccountChange owner's own canonical materialization/checkpoint.
        }
    }
}

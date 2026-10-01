import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { handleTodoKvBatchUpdate } from '@/sync/engine/social/syncFeed';

export type KvSocketChange = Readonly<{ key: string; value: string | null; version: number }>;
type KvSubscription = Readonly<{
    prefix: string;
    credentials: AuthCredentials;
    shouldContinue: () => boolean;
    listener: (changes: readonly KvSocketChange[]) => void;
}>;
const subscriptions = new Set<KvSubscription>();

/** Subscribers retain their mounted Account lifetime; no KV value is owned here. */
export function subscribeKvPrefixChanges(
    prefix: string,
    listener: KvSubscription['listener'],
    scope: Pick<KvSubscription, 'credentials' | 'shouldContinue'>,
): () => void {
    const subscription = { prefix, listener, ...scope };
    subscriptions.add(subscription);
    return () => { subscriptions.delete(subscription); };
}

function readChanges(value: unknown): KvSocketChange[] {
    if (!Array.isArray(value)) return [];
    return value.filter((change): change is KvSocketChange => {
        if (typeof change !== 'object' || change === null) return false;
        return 'key' in change && typeof change.key === 'string'
            && 'value' in change && (typeof change.value === 'string' || change.value === null)
            && 'version' in change && typeof change.version === 'number' && Number.isInteger(change.version);
    });
}

export async function dispatchKvBatchUpdate(params: Readonly<{
    kvUpdate: { changes?: unknown };
    credentials?: AuthCredentials | null;
    shouldContinue: () => boolean;
    applyTodoSocketUpdates: (changes: KvSocketChange[]) => Promise<void>;
    invalidateTodosSync: () => void;
    log: { log: (message: string) => void };
}>): Promise<void> {
    if (!params.shouldContinue()) return;
    const changes = readChanges(params.kvUpdate.changes);
    // Notify other domains before the effectful todo handler can yield or fail.
    for (const subscription of [...subscriptions]) {
        if (!params.shouldContinue()) return;
        if (!subscriptions.has(subscription) || !subscription.shouldContinue()
            || subscription.credentials.token !== params.credentials?.token) continue;
        const matching = changes.filter(change => change.key.startsWith(subscription.prefix));
        if (matching.length > 0) subscription.listener(matching);
    }
    if (!params.shouldContinue()) return;
    const todoChanges = changes.filter(change => change.key.startsWith('todo.'));
    if (todoChanges.length === 0) return;
    await handleTodoKvBatchUpdate({
        kvUpdate: { changes: todoChanges },
        applyTodoSocketUpdates: async scopedChanges => {
            if (params.shouldContinue()) await params.applyTodoSocketUpdates(scopedChanges);
        },
        invalidateTodosSync: () => {
            if (params.shouldContinue()) params.invalidateTodosSync();
        },
        log: params.log,
    });
}

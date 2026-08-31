import { afterTx, type Tx } from '@/storage/inTx';

export type SessionTranscriptMutation =
    | Readonly<{ kind: 'upsert'; message: Readonly<{ id: string; sessionId: string; seq: number; createdAtMs: number; updatedAtMs?: number; role?: string | null; content: unknown }> }>
    | Readonly<{ kind: 'remove-messages'; messageIds: readonly string[] }>
    | Readonly<{ kind: 'remove-session'; sessionId: string }>;

type SessionTranscriptMutationObserver = (mutation: SessionTranscriptMutation) => void;
let observer: SessionTranscriptMutationObserver | null = null;

/** Registers the single rebuildable projection observer for canonical transcript commits. */
export function registerSessionTranscriptMutationObserver(nextObserver: SessionTranscriptMutationObserver): () => void {
    observer = nextObserver;
    return () => {
        if (observer === nextObserver) observer = null;
    };
}

/** Delivers best-effort derived projection work only after commit and detached from transcript truth. */
export function notifySessionTranscriptMutationAfterCommit(tx: Tx, mutation: SessionTranscriptMutation): void {
    afterTx(tx, () => {
        queueMicrotask(() => {
            try {
                observer?.(mutation);
            } catch {
                // The derived projection degrades itself; canonical transcript authority won.
            }
        });
    });
}

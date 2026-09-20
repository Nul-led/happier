import type { NormalizedMessage } from '@/sync/typesRaw';

import { WorkspaceMutationInvalidator } from './workspaceMutationInvalidator';

export type WorkspaceMutationIngestionOptions = Readonly<{
    debounceMs: number;
    minUnknownOnlyIntervalMs: number;
    now: () => number;
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
    invalidateKnownMutation: (sessionId: string, changedPaths: readonly string[], serverId: string | null) => void;
    invalidateUnknownMutation: (sessionId: string, serverId: string | null) => void;
}>;

export type WorkspaceMutationIngestion = Readonly<{
    ingest: (sessionId: string, messages: readonly NormalizedMessage[], serverId?: string | null) => void;
}>;

export function createWorkspaceMutationIngestion(options: WorkspaceMutationIngestionOptions): WorkspaceMutationIngestion {
    const invalidator = new WorkspaceMutationInvalidator({
        debounceMs: options.debounceMs,
        minUnknownOnlyIntervalMs: options.minUnknownOnlyIntervalMs,
        now: options.now,
        setTimer: options.setTimer,
        clearTimer: options.clearTimer,
        onInvalidate: (event) => {
            if (event.changedPaths.length > 0) {
                options.invalidateKnownMutation(event.sessionId, event.changedPaths, event.serverId);
                return;
            }
            if (event.hasUnknownMutations) {
                options.invalidateUnknownMutation(event.sessionId, event.serverId);
            }
        },
    });

    return {
        ingest: (sessionId, messages, serverId) => invalidator.ingest(sessionId, messages, serverId),
    };
}

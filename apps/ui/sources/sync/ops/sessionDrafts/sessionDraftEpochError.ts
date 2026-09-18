/**
 * The Home does not support the V2 draft address epoch. The local draft is
 * retained exactly as authored; it is never retried through V1, coerced onto a
 * main Session address, or written to generic Account KV.
 */
export class SessionDraftEpochUnavailableError extends Error {
    readonly code = 'session_draft_epoch_unavailable' as const;

    constructor() {
        super('Session draft V2 operations are unavailable on this server');
        this.name = 'SessionDraftEpochUnavailableError';
    }
}

export function isSessionDraftEpochUnavailableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    return 'code' in error && error.code === 'session_draft_epoch_unavailable';
}

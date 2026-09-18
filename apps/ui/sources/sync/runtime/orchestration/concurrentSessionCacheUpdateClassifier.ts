const CONCURRENT_SESSION_CACHE_REFRESH_UPDATE_TYPES = new Set([
    'account-change',
    'new-machine',
    'update-machine',
    'new-session',
    'delete-session',
    'pending-changed',
    'update-session',
    'new-message',
    'message-updated',
]);

function readConcurrentUpdateType(raw: unknown): string | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const body = (raw as { body?: unknown }).body;
    if (!body || typeof body !== 'object') {
        return null;
    }

    const updateType = (body as { t?: unknown }).t;
    return typeof updateType === 'string' ? updateType : null;
}

export function shouldRefreshConcurrentSessionCacheForUpdate(raw: unknown): boolean {
    const updateType = readConcurrentUpdateType(raw);
    return updateType !== null && CONCURRENT_SESSION_CACHE_REFRESH_UPDATE_TYPES.has(updateType);
}

export function isAccountChangeUpdate(raw: unknown): boolean {
    const type = readConcurrentUpdateType(raw);
    return type === 'update-account' || type === 'account-change';
}

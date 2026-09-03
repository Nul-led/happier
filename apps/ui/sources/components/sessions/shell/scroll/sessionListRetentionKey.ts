import type { SessionListStorageFilter } from '@/sync/domains/session/sessionStorageKind';

function encodeRetentionKeyPart(value: string): string {
    return `${value.length}:${value}`;
}

export function buildSessionListRetentionKey(
    storageKind: SessionListStorageFilter | undefined,
    sourceScopeKey: string,
): string {
    return [
        'sessions-list',
        encodeRetentionKeyPart(storageKind ?? 'all'),
        encodeRetentionKeyPart(sourceScopeKey),
    ].join(':');
}

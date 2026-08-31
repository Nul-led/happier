import type { Settings } from '@/sync/domains/settings/settings';

export type ServerSelectionActiveTargetDelta = Pick<
    Settings,
    'serverSelectionActiveTargetKind' | 'serverSelectionActiveTargetId'
>;

function normalizeServerId(raw: unknown): string {
    return String(raw ?? '').trim();
}

export function buildServerSelectionActiveTargetForServer(serverIdRaw: unknown): ServerSelectionActiveTargetDelta {
    const serverId = normalizeServerId(serverIdRaw);
    return {
        serverSelectionActiveTargetKind: serverId ? 'server' : null,
        serverSelectionActiveTargetId: serverId || null,
    };
}

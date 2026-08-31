import { normalizeStoredServerSelectionGroups } from './serverSelectionMutations';
import type { ServerSelectionSettingsLike } from './serverSelectionTypes';
import type { Settings } from '@/sync/domains/settings/settings';

function normalizeTargetKind(raw: unknown): 'server' | 'group' | null {
    return raw === 'server' || raw === 'group' ? raw : null;
}

export function normalizeServerSelectionGroupsForSettings(
    raw: unknown,
): Settings['serverSelectionGroups'] {
    return normalizeStoredServerSelectionGroups(raw).map((group) => ({
        id: group.id,
        name: group.name,
        serverIds: [...group.serverIds],
        presentation: group.presentation === 'flat-with-badge' ? 'flat-with-badge' : 'grouped',
    }));
}

export function stripServerSelectionSettingsProjection(settings: Settings): Partial<Settings> {
    const {
        serverSelectionGroups: _serverSelectionGroups,
        serverSelectionActiveTargetKind: _serverSelectionActiveTargetKind,
        serverSelectionActiveTargetId: _serverSelectionActiveTargetId,
        ...rest
    } = settings;
    return rest;
}

export function toServerSelectionSettings(
    settings: Readonly<{
        serverSelectionGroups: unknown;
        serverSelectionActiveTargetKind: unknown;
        serverSelectionActiveTargetId: unknown;
    }>,
): ServerSelectionSettingsLike {
    return {
        serverSelectionGroups: normalizeStoredServerSelectionGroups(settings.serverSelectionGroups),
        serverSelectionActiveTargetKind: normalizeTargetKind(settings.serverSelectionActiveTargetKind),
        serverSelectionActiveTargetId:
            typeof settings.serverSelectionActiveTargetId === 'string' ? settings.serverSelectionActiveTargetId : null,
    };
}

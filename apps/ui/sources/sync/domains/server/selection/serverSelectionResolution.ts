import { readUsableHomeServerIds } from '@/sync/domains/scope/usableHomeServerIds';

import { getEffectiveServerSelection, resolveActiveServerSelection } from './serverSelectionResolver';
import { toServerSelectionSettings } from './serverSelectionSettingsAdapter';
import type { EffectiveServerSelection, ResolvedActiveServerSelection } from './serverSelectionTypes';

export type RawServerSelectionSettings = Readonly<{
    serverSelectionGroups: unknown;
    serverSelectionActiveTargetKind: unknown;
    serverSelectionActiveTargetId: unknown;
}>;

export function resolveActiveServerSelectionFromRawSettings(params: Readonly<{
    activeServerId: string;
    availableServerIds: ReadonlyArray<string>;
    settings: RawServerSelectionSettings;
    /** Homes this device can use; defaults to the credential-backed projection. */
    usableServerIds?: ReadonlyArray<string> | null;
}>): ResolvedActiveServerSelection {
    return resolveActiveServerSelection({
        activeServerId: params.activeServerId,
        availableServerIds: params.availableServerIds,
        settings: toServerSelectionSettings(params.settings),
        // Every reader (the session list's concurrent cache, the Home pickers) resolves the same
        // default from the same credential-backed projection.
        usableServerIds: params.usableServerIds !== undefined ? params.usableServerIds : readUsableHomeServerIds(),
    });
}

export function getEffectiveServerSelectionFromRawSettings(params: Readonly<{
    activeServerId: string;
    availableServerIds: ReadonlyArray<string>;
    settings: RawServerSelectionSettings;
    /** Homes this device can use; defaults to the credential-backed projection. */
    usableServerIds?: ReadonlyArray<string> | null;
}>): EffectiveServerSelection {
    return getEffectiveServerSelection({
        activeServerId: params.activeServerId,
        availableServerIds: params.availableServerIds,
        settings: toServerSelectionSettings(params.settings),
        // Every reader (the session list's concurrent cache, the Home pickers) resolves the same
        // default from the same credential-backed projection.
        usableServerIds: params.usableServerIds !== undefined ? params.usableServerIds : readUsableHomeServerIds(),
    });
}

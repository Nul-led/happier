import * as React from 'react';

import type { Settings } from '@/sync/domains/settings/settings';
import {
    loadHomeViewState,
    subscribeHomeViewState,
    updateHomeViewState,
} from '@/sync/domains/server/serverProfiles';
import { normalizeServerSelectionGroupsForSettings } from '@/sync/domains/server/selection/serverSelectionSettingsAdapter';
import { getStorage } from '@/sync/domains/state/storageStore';

export type HomeViewSelectionSettings = Pick<
    Settings,
    'serverSelectionGroups' | 'serverSelectionActiveTargetKind' | 'serverSelectionActiveTargetId'
>;

export function useHomeViewSelectionSettings(
    fallback: HomeViewSelectionSettings,
): HomeViewSelectionSettings {
    const state = React.useSyncExternalStore(
        subscribeHomeViewState,
        loadHomeViewState,
        loadHomeViewState,
    );
    return React.useMemo(() => state
        ? {
            serverSelectionGroups: normalizeServerSelectionGroupsForSettings(state.groups),
            serverSelectionActiveTargetKind: state.activeTargetKind,
            serverSelectionActiveTargetId: state.activeTargetId,
        }
        : fallback, [fallback, state]);
}

export function useHomeViewSelectionSettingsMutable(
    fallback: HomeViewSelectionSettings,
): HomeViewSelectionSettings & Readonly<{
    setHomeViewSelectionSettings: (
        update: HomeViewSelectionSettings | ((current: HomeViewSelectionSettings) => HomeViewSelectionSettings),
    ) => void;
}> {
    const settings = useHomeViewSelectionSettings(fallback);
    const setHomeViewSelectionSettings = React.useCallback((
        update: HomeViewSelectionSettings | ((current: HomeViewSelectionSettings) => HomeViewSelectionSettings),
    ) => {
        const saved = updateHomeViewState((current) => {
            const currentSettings: HomeViewSelectionSettings = {
                serverSelectionGroups: normalizeServerSelectionGroupsForSettings(current.groups),
                serverSelectionActiveTargetKind: current.activeTargetKind,
                serverSelectionActiveTargetId: current.activeTargetId,
            };
            const requested = typeof update === 'function' ? update(currentSettings) : update;
            return {
                version: 1,
                groups: requested.serverSelectionGroups,
                activeTargetKind: requested.serverSelectionActiveTargetKind,
                activeTargetId: requested.serverSelectionActiveTargetId,
            };
        });
        const projected: HomeViewSelectionSettings = {
            serverSelectionGroups: normalizeServerSelectionGroupsForSettings(saved.groups),
            serverSelectionActiveTargetKind: saved.activeTargetKind,
            serverSelectionActiveTargetId: saved.activeTargetId,
        };
        // Compatibility projection for existing Settings readers only. The Account-scoped
        // settings transport must never become a writer for device-global Home selection.
        getStorage().getState().applySettingsLocal(projected);
    }, []);
    return React.useMemo(() => ({
        ...settings,
        setHomeViewSelectionSettings,
    }), [settings, setHomeViewSelectionSettings]);
}

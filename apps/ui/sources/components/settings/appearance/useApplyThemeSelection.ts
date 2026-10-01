import * as React from 'react';
import { Appearance, Platform } from 'react-native';
import { setStatusBarStyle } from 'expo-status-bar';
import { useUnistyles } from 'react-native-unistyles';

import { runThemePreferenceChange } from '@/components/settings/appearance/themePreferenceTransition';
import { resolveStatusBarStyleForThemePreference, type ThemePreference } from '@/components/ui/layout/statusBarStyle';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { useLocalSettingMutable } from '@/sync/domains/state/storage';
import { DEFAULT_THEME_PROFILES_LOCAL_STATE } from '@/theme/profiles/themeProfilePersistence';
import { applyThemeRuntimeSelection } from '@/theme/profiles/themeProfileRuntime';
import type { ThemeProfilesLocalStateV1 } from '@/theme/profiles/themeProfileTypes';

/**
 * The one writer for the theme mode and the theme each mode uses. It stores both, applies them to the
 * running theme and the status bar, and plays the mode transition — every surface that changes the
 * theme goes through it so none can store a choice without applying it.
 */
export function useApplyThemeSelection(): (
    nextThemePreference: ThemePreference,
    nextThemeProfiles: ThemeProfilesLocalStateV1,
) => void {
    const reduceMotion = useReducedMotionPreference();
    const [themePreference, setThemePreference] = useLocalSettingMutable('themePreference');
    const [, setThemeProfiles] = useLocalSettingMutable('themeProfiles');
    return React.useCallback((nextThemePreference, nextThemeProfiles) => {
        const systemTheme = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
        void runThemePreferenceChange({
            currentPreference: themePreference,
            nextPreference: nextThemePreference,
            platform: Platform.OS,
            reduceMotion,
            forceAnimate: true,
            systemTheme,
            mutation: () => {
                setThemePreference(nextThemePreference);
                setThemeProfiles(nextThemeProfiles);
                applyThemeRuntimeSelection({
                    themePreference: nextThemePreference,
                    themeProfiles: nextThemeProfiles,
                    systemTheme,
                });
                setStatusBarStyle(resolveStatusBarStyleForThemePreference(nextThemePreference, systemTheme), true);
            },
        });
    }, [reduceMotion, setThemePreference, setThemeProfiles, themePreference]);
}

/** The theme mode a stored preference means; anything unrecognised follows the system. */
export function resolveThemeMode(themePreference: unknown): ThemePreference {
    return themePreference === 'light' || themePreference === 'dark' ? themePreference : 'adaptive';
}

/**
 * Light ↔ dark in one press (the shell's title-strip toggle). The next mode is the opposite of the
 * theme on screen, stored as an explicit mode — so Adaptive becomes Light or Dark — through the same
 * writer as Settings → Appearance, keeping the theme each mode uses.
 */
export function useToggleThemeMode(): () => void {
    const { theme } = useUnistyles();
    const [themeProfiles] = useLocalSettingMutable('themeProfiles');
    const applyThemeSelection = useApplyThemeSelection();
    const screenDark = theme.dark;
    return React.useCallback(() => {
        applyThemeSelection(screenDark ? 'light' : 'dark', themeProfiles ?? DEFAULT_THEME_PROFILES_LOCAL_STATE);
    }, [applyThemeSelection, screenDark, themeProfiles]);
}

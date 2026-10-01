import * as React from 'react';
import { Animated, Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { resolveThemeMode, useApplyThemeSelection, useToggleThemeMode } from '@/components/settings/appearance/useApplyThemeSelection';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Icon } from '@/components/ui/icons/Icon';
import { motionTokens } from '@/components/ui/motion';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { useLocalSettingMutable } from '@/sync/domains/state/storage';
import { DEFAULT_THEME_PROFILES_LOCAL_STATE } from '@/theme/profiles/themeProfilePersistence';
import { t } from '@/text';

const MENU_HIDE_ID = 'hide';

/**
 * Light ↔ dark from the title strip. The glyph is a circle with one half filled: it turns over as the
 * theme changes, so the filled half reads as "the other mode". A press switches through the theme
 * owner (`useToggleThemeMode`); a long press or a right click opens the mode choices and "Hide from
 * toolbar". Whether it shows is a device-local preference that Settings → Appearance turns back on.
 */
export const AppShellThemeToggle = React.memo(function AppShellThemeToggle(props: Readonly<{
    buttonSize: number;
    glyphSize: number;
    color: string;
}>) {
    const [visible, setVisible] = useLocalSettingMutable('titleStripThemeToggleVisible');
    if (visible === false) return null;
    return <ThemeToggleButton {...props} onHide={() => setVisible(false)} />;
});

function ThemeToggleButton(props: Readonly<{
    buttonSize: number;
    glyphSize: number;
    color: string;
    onHide: () => void;
}>) {
    const { theme } = useUnistyles();
    const toggle = useToggleThemeMode();
    const applyThemeSelection = useApplyThemeSelection();
    const [themePreference] = useLocalSettingMutable('themePreference');
    const [themeProfiles] = useLocalSettingMutable('themeProfiles');
    const [menuOpen, setMenuOpen] = React.useState(false);
    const dark = theme.dark;
    const label = dark ? t('settingsAppearance.switchToLightTheme') : t('settingsAppearance.switchToDarkTheme');
    const mode = resolveThemeMode(themePreference);
    const items = React.useMemo((): readonly DropdownMenuItem[] => [
        { id: 'light', testID: 'app-shell-theme-menu-light', title: t('settingsAppearance.themeOptions.light'),
            icon: <Icon name="sun" size={16} color={theme.colors.text.secondary} />, checked: mode === 'light' },
        { id: 'dark', testID: 'app-shell-theme-menu-dark', title: t('settingsAppearance.themeOptions.dark'),
            icon: <Icon name="moon" size={16} color={theme.colors.text.secondary} />, checked: mode === 'dark' },
        { id: 'adaptive', testID: 'app-shell-theme-menu-adaptive', title: t('settingsAppearance.themeToggle.matchSystem'),
            icon: <Icon name="desktop" size={16} color={theme.colors.text.secondary} />, checked: mode === 'adaptive' },
        { id: MENU_HIDE_ID, testID: 'app-shell-theme-menu-hide', title: t('settingsAppearance.themeToggle.hideFromToolbar'),
            icon: <Icon name="eye-slash" size={16} color={theme.colors.text.secondary} /> },
    ], [mode, theme.colors.text.secondary]);
    const select = React.useCallback((id: string) => {
        setMenuOpen(false);
        if (id === MENU_HIDE_ID) {
            props.onHide();
            return;
        }
        if (id === 'light' || id === 'dark' || id === 'adaptive') {
            applyThemeSelection(id, themeProfiles ?? DEFAULT_THEME_PROFILES_LOCAL_STATE);
        }
    }, [applyThemeSelection, props.onHide, themeProfiles]);
    const openMenu = React.useCallback(() => setMenuOpen(true), []);
    const openMenuFromContext = React.useCallback((event: unknown) => {
        (event as { preventDefault?: () => void } | null)?.preventDefault?.();
        setMenuOpen((open) => !open);
    }, []);
    return (
        <DropdownMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            items={items}
            onSelect={select}
            search={false}
            matchTriggerWidth={false}
            maxWidthCap={240}
            placement="bottom"
            popoverAnchorAlign="start"
            trigger={() => (
                <IconButton
                    testID="app-shell-theme-toggle"
                    variant="plain"
                    size={props.buttonSize}
                    accessibilityLabel={label}
                    tooltip={label}
                    tooltipPlacement="bottom"
                    tooltipHidden={menuOpen}
                    hasPopup="menu"
                    expanded={menuOpen}
                    icon={<ThemeToggleGlyph dark={dark} size={props.glyphSize} color={props.color} />}
                    onPress={toggle}
                    onLongPress={openMenu}
                    onContextMenu={openMenuFromContext}
                />
            )}
        />
    );
}

/** The half-filled circle turns half a turn between the modes; it starts settled (nothing animates on arrival). */
function ThemeToggleGlyph(props: Readonly<{ dark: boolean; size: number; color: string }>) {
    const styles = stylesheet;
    const reducedMotion = useReducedMotionPreference();
    const progress = React.useRef(new Animated.Value(props.dark ? 1 : 0)).current;
    React.useEffect(() => {
        const animation = Animated.timing(progress, {
            toValue: props.dark ? 1 : 0,
            duration: reducedMotion ? motionTokens.durationMs.instant : motionTokens.durationMs.fast,
            easing: motionTokens.easing.standard,
            useNativeDriver: Platform.OS !== 'web',
        });
        animation.start();
        return () => animation.stop();
    }, [progress, props.dark, reducedMotion]);
    const turn = { transform: [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] };
    return (
        <View style={[styles.glyph, { width: props.size, height: props.size }]}>
            <Animated.View style={[styles.layer, turn]}>
                <Icon name="circle-half" weight="fill" size={props.size} color={props.color} />
            </Animated.View>
        </View>
    );
}

const stylesheet = StyleSheet.create(() => ({
    glyph: {
        position: 'relative',
    },
    layer: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));

import { Platform } from 'react-native';
import type { UnistylesThemes } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { resolveThemeSurfaceBorderStyle } from '@/components/ui/surfaces/resolveThemeHairlineBorderStyle';

import { COMPOSER_SURFACE_RADIUS } from '../composerContentInset';

type Theme = UnistylesThemes[keyof UnistylesThemes];

/**
 * The composer's own chrome: the panel around the input and the action chips under it. `AgentInput`
 * paints these, and settings previews render the same chips inside the same panel, so the two
 * cannot drift apart.
 */
/** Native rows state their rhythm as margins; chips and the rows around them share this one. */
export const NATIVE_ACTION_CHIP_GAP_Y = 1;
export const AGENT_INPUT_PANEL_PADDING_TOP = 2;
export const AGENT_INPUT_PANEL_PADDING_BOTTOM = 8;
export const AGENT_INPUT_PANEL_RADIUS = COMPOSER_SURFACE_RADIUS;

export function resolveAgentInputPanelStyle(theme: Theme) {
    return {
        backgroundColor: theme.colors.input.background,
        borderRadius: AGENT_INPUT_PANEL_RADIUS,
        ...resolveThemeSurfaceBorderStyle({
            borderColor: theme.colors.border.surface,
            highlightColor: theme.colors.effect.surfaceHighlight,
        }),
        overflow: 'hidden' as const,
        paddingTop: AGENT_INPUT_PANEL_PADDING_TOP,
        paddingBottom: AGENT_INPUT_PANEL_PADDING_BOTTOM,
        paddingHorizontal: 8,
    };
}

export const AGENT_INPUT_ACTION_CHIP_STYLE = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    borderRadius: Platform.select({ default: 16, android: 20 }),
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'center' as const,
    height: 32,
    gap: 6,
    ...(Platform.OS === 'web' ? {} : { marginRight: 6, marginBottom: NATIVE_ACTION_CHIP_GAP_Y }),
};

/** A chip whose label is hidden (icon-only density). */
export const AGENT_INPUT_ACTION_CHIP_ICON_ONLY_STYLE = {
    paddingHorizontal: 8,
    gap: 0,
};

export function resolveAgentInputActionChipTextStyle(theme: Theme) {
    return {
        fontSize: 13,
        color: theme.colors.composer.chipTint,
        fontWeight: '600' as const,
        ...Typography.default('semiBold'),
    };
}

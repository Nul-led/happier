import * as React from 'react';
import { View } from 'react-native';

import { darkTheme, lightTheme } from '@/theme';

type Palette = Readonly<{
    colors: Readonly<{
        background: Readonly<{ canvas: string }>;
        surface: Readonly<{ base: string; elevated: string }>;
        border: Readonly<{ default: string; strong: string }>;
    }>;
}>;

const MINIATURE_BAR_HEIGHT = 14;
/** Today's (soft) radii at miniature scale, kept for tiles that do not preview a radius scale. */
const DEFAULT_MINIATURE_RADIUS = 5;

/**
 * A miniature of a Happier window painted from a theme's own tokens, so the tile shows what the theme
 * looks like rather than naming it. This is an illustrative app shell, not a session preview.
 * Static: no subscriptions, no runtime theme reads. Pass any resolved theme (a base theme or a theme
 * profile resolved with `resolveThemeProfile`).
 */
export function ThemePalettePreview(props: Readonly<{
    palette: Palette;
}>) {
    const c = props.palette.colors;
    const bubbleRadius = DEFAULT_MINIATURE_RADIUS;
    const composerRadius = DEFAULT_MINIATURE_RADIUS;
    const line = (width: `${number}%`, color: string, marginTop = 5) => (
        <View style={{ height: 5, borderRadius: 3, width, backgroundColor: color, marginTop }} />
    );
    return (
        <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.background.canvas }}>
            <View style={{ width: '34%', paddingHorizontal: 6, paddingTop: 5, backgroundColor: c.surface.base, borderRightWidth: 1, borderRightColor: c.border.default }}>
                {line('70%', c.border.strong, 3)}
                {line('90%', c.surface.elevated)}
                {line('80%', c.surface.elevated)}
                {line('60%', c.surface.elevated)}
            </View>
            <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 7 }}>
                {line('55%', c.border.strong, 0)}
                {line('85%', c.surface.elevated)}
                <View style={{ height: MINIATURE_BAR_HEIGHT, width: '60%', alignSelf: 'flex-end', marginTop: 6, borderRadius: bubbleRadius, backgroundColor: c.surface.elevated }} />
                <View style={{ position: 'absolute', left: 8, right: 8, bottom: 7, height: MINIATURE_BAR_HEIGHT, borderRadius: composerRadius, backgroundColor: c.surface.base, borderWidth: 1, borderColor: c.border.default }} />
            </View>
        </View>
    );
}

export const ThemeModePreview = React.memo(function ThemeModePreview(props: Readonly<{ mode: 'adaptive' | 'light' | 'dark' }>) {
    if (props.mode === 'adaptive') {
        return (
            <View style={{ flex: 1, flexDirection: 'row' }}>
                <View style={{ flex: 1, overflow: 'hidden' }}>
                    <View style={{ width: '200%', height: '100%' }}><ThemePalettePreview palette={lightTheme} /></View>
                </View>
                <View style={{ flex: 1, overflow: 'hidden' }}>
                    <View style={{ width: '200%', height: '100%', marginLeft: '-100%' }}><ThemePalettePreview palette={darkTheme} /></View>
                </View>
            </View>
        );
    }
    return <ThemePalettePreview palette={props.mode === 'dark' ? darkTheme : lightTheme} />;
});

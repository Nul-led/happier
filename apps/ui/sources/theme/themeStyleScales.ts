import { Platform } from 'react-native';

/**
 * The style scales every theme carries: the radius scale, spacing, the radius of the five session parts,
 * the transcript rhythm and the theme-held font families. The default of each table is exactly what the
 * app rendered before these became theme values; the full app always uses the defaults. The embed
 * (plan 04 §4.7, `EmbedStyleV1`) selects other steps through `applyThemeRuntimeSelection`'s `style`.
 */

export type ThemeRadiusScaleName = 'sharp' | 'soft' | 'round';
export type ThemeDensityName = 'compact' | 'comfortable';
export type ThemeRadiusStep = 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | 'modalCard';
export type ThemePartName = 'userBubble' | 'composer' | 'toolCard' | 'approvalCard' | 'codeBlock';

type RadiusScale = Readonly<Record<ThemeRadiusStep, number>>;

const RADIUS_SCALES: Readonly<Record<ThemeRadiusScaleName, RadiusScale>> = {
    sharp: { sm: 2, md: 4, lg: 5, xl: 6, xxl: 8, modalCard: 8 },
    // Today's radii: checkboxes 4, buttons 8, fields 10, cards 12, main containers 16, modal cards 14.
    soft: { sm: 4, md: 8, lg: 10, xl: 12, xxl: 16, modalCard: 14 },
    round: { sm: 6, md: 12, lg: 14, xl: 18, xxl: 24, modalCard: 20 },
};

/** The step each part takes from the active radius scale unless the style picks another. */
const PART_RADIUS_STEPS: Readonly<Record<ThemePartName, ThemeRadiusStep>> = {
    userBubble: 'xl',
    composer: 'xxl',
    toolCard: 'md',
    approvalCard: 'xl',
    codeBlock: 'lg',
};

/** Android draws the composer stack 4 px rounder than its step (today 20 against 16). */
const ANDROID_COMPOSER_RADIUS_EXTRA = Platform.OS === 'android' ? 4 : 0;

type Margins = Readonly<{ xs: number; sm: number; md: number; lg: number; xl: number; xxl: number }>;

const DENSITY_SCALES: Readonly<Record<ThemeDensityName, Readonly<{ margins: Margins; transcript: Readonly<{ messageGap: number }> }>>> = {
    // Today's spacing and the transcript's 22 px between messages.
    comfortable: { margins: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 }, transcript: { messageGap: 22 } },
    compact: { margins: { xs: 3, sm: 6, md: 10, lg: 12, xl: 16, xxl: 20 }, transcript: { messageGap: 14 } },
};

export type ThemeStyleSelection = Readonly<{
    radius?: ThemeRadiusScaleName;
    density?: ThemeDensityName;
    parts?: Readonly<Partial<Record<ThemePartName, Readonly<{ radius?: ThemeRadiusStep }>>>>;
    /** A font family name; `null`/absent keeps the Happier family. */
    fontFamily?: string | null;
    monoFontFamily?: string | null;
}>;

export type ThemeStyleScales = Readonly<{
    borderRadius: RadiusScale;
    margins: Margins;
    parts: Readonly<Record<ThemePartName, Readonly<{ radius: number }>>>;
    transcript: Readonly<{ messageGap: number }>;
    typography: Readonly<{ fontFamily: string | null; monoFontFamily: string | null }>;
}>;

const PART_NAMES = Object.keys(PART_RADIUS_STEPS) as ThemePartName[];

function normalizeFamily(value: string | null | undefined): string | null {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
}

export function resolveThemeStyleScales(selection: ThemeStyleSelection | null = null): ThemeStyleScales {
    const borderRadius = RADIUS_SCALES[selection?.radius ?? 'soft'];
    const density = DENSITY_SCALES[selection?.density ?? 'comfortable'];
    const parts = Object.fromEntries(PART_NAMES.map((part) => {
        const step = selection?.parts?.[part]?.radius ?? PART_RADIUS_STEPS[part];
        const extra = part === 'composer' ? ANDROID_COMPOSER_RADIUS_EXTRA : 0;
        return [part, { radius: borderRadius[step] + extra }];
    })) as Record<ThemePartName, { radius: number }>;

    return {
        borderRadius,
        margins: density.margins,
        parts,
        transcript: density.transcript,
        typography: {
            fontFamily: normalizeFamily(selection?.fontFamily),
            monoFontFamily: normalizeFamily(selection?.monoFontFamily),
        },
    };
}

export const DEFAULT_THEME_STYLE_SCALES = resolveThemeStyleScales();

function readScales(theme: ThemeStyleScales): ThemeStyleScales {
    return {
        borderRadius: theme.borderRadius,
        margins: theme.margins,
        parts: theme.parts,
        transcript: theme.transcript,
        typography: theme.typography,
    };
}

/**
 * Returns the theme with these scales; colours and every other field are kept by reference. A theme
 * that already carries equal scales is returned as is, so the full app's themes keep their identity.
 */
export function applyThemeStyleScales<T extends ThemeStyleScales>(theme: T, scales: ThemeStyleScales): T {
    if (JSON.stringify(readScales(theme)) === JSON.stringify(readScales(scales))) return theme;
    return {
        ...theme,
        borderRadius: scales.borderRadius,
        margins: scales.margins,
        parts: scales.parts,
        transcript: scales.transcript,
        typography: scales.typography,
    };
}

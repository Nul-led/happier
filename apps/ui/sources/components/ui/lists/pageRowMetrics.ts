import { Platform } from 'react-native';
import { HAPPIER_PAGE_METRICS, HAPPIER_PAGE_TEXT } from '@happier-dev/plugin-ui/presentation';

import { ICON_SIZE } from '@/components/ui/icons/Icon';
import type { ResolvedItemDensity } from '@/components/ui/lists/useResolvedItemDensity';
import { isTouchPrimaryPointer as isSharedTouchPrimaryPointer } from '@/components/ui/interactiveTargetSize';

function selectValue<T>(values: { ios?: T; default: T }): T {
    return Platform.select(values) ?? values.default;
}

/**
 * The densities a configuration-page row is drawn at: the user's list-density preference. An explicit
 * `tight` (editor-like lists) has no page shape of its own and draws as `compact`.
 */
export type PageRowDensity = 'comfortable' | 'cozy' | 'compact';

/**
 * A page row's two shapes. `standard` is any row of a section; `list` is a row of a long index-style
 * list of single-line rows (the section asks for it with `ItemGroup density="compact"`), which is the
 * compact shape of the same density rather than a density of its own — so the preference still reaches
 * it.
 */
export type PageRowShape = 'standard' | 'list';

type PageRowText = Readonly<{ fontSize: number; lineHeight: number; letterSpacing: number }>;

export type PageRowMetrics = Readonly<{
    minHeightPx: number;
    paddingVerticalPx: number;
    title: PageRowText;
    subtitle: PageRowText & Readonly<{ marginTop: number }>;
    iconGlyphPx: number;
}>;

/**
 * A finger's minimum target: every page row is at least this tall when the primary pointer is touch
 * (iOS HIG 44pt; the design doctrine's touch floor). A precise pointer keeps the denser desktop rows.
 */
export const PAGE_ROW_TOUCH_MIN_HEIGHT_PX = 44;

const PAGE_TITLE = HAPPIER_PAGE_TEXT.rowTitle;
const PAGE_DESCRIPTION = HAPPIER_PAGE_TEXT.rowDescription;

/**
 * The configuration-page row at each density: the lab's desktop scale, where the default (`cozy`) is
 * exactly the shared page anatomy plugin pages draw (`HAPPIER_PAGE_METRICS` / `HAPPIER_PAGE_TEXT`), and
 * the other two step one notch roomier or denser around it. Line heights stay close to the type size
 * so a description sits a few pixels under its title at every density, not a line away.
 */
const PAGE_ROW_DENSITY_METRICS: Record<PageRowDensity, Readonly<{
    standard: Readonly<{ minHeightPx: number; paddingVerticalPx: number }>;
    list: Readonly<{ minHeightPx: number; paddingVerticalPx: number }>;
    title: PageRowText;
    subtitle: PageRowText;
    iconGlyphPx: number;
}>> = {
    comfortable: {
        standard: { minHeightPx: 56, paddingVerticalPx: 16 },
        list: { minHeightPx: 44, paddingVerticalPx: 12 },
        title: { fontSize: selectValue({ ios: 17, default: 15 }), lineHeight: selectValue({ ios: 22, default: 20 }), letterSpacing: selectValue({ ios: -0.41, default: 0.1 }) },
        subtitle: { fontSize: selectValue({ ios: 14, default: 13 }), lineHeight: selectValue({ ios: 19, default: 18 }), letterSpacing: 0 },
        iconGlyphPx: ICON_SIZE.md,
    },
    cozy: {
        standard: { minHeightPx: HAPPIER_PAGE_METRICS.rowMinHeightPx, paddingVerticalPx: HAPPIER_PAGE_METRICS.rowPaddingVerticalPx },
        list: { minHeightPx: HAPPIER_PAGE_METRICS.compactRowMinHeightPx, paddingVerticalPx: HAPPIER_PAGE_METRICS.compactRowPaddingVerticalPx },
        title: { fontSize: PAGE_TITLE.fontSize, lineHeight: PAGE_TITLE.lineHeight, letterSpacing: PAGE_TITLE.letterSpacing ?? 0 },
        subtitle: { fontSize: PAGE_DESCRIPTION.fontSize, lineHeight: PAGE_DESCRIPTION.lineHeight, letterSpacing: PAGE_DESCRIPTION.letterSpacing ?? 0 },
        iconGlyphPx: HAPPIER_PAGE_METRICS.rowIconGlyphPx,
    },
    compact: {
        standard: { minHeightPx: 44, paddingVerticalPx: 10 },
        list: { minHeightPx: 34, paddingVerticalPx: 7 },
        title: { fontSize: selectValue({ ios: 14, default: 13 }), lineHeight: 18, letterSpacing: selectValue({ ios: -0.24, default: 0.1 }) },
        subtitle: { fontSize: 12, lineHeight: 16, letterSpacing: 0 },
        iconGlyphPx: ICON_SIZE.sm,
    },
};

/** Between a page row's title and its description, at every density. */
const PAGE_ROW_SUBTITLE_GAP_PX = 2;

const resolvedPageRowMetrics = new Map<string, PageRowMetrics>();

/**
 * A page row's box, type and glyph for a density and shape. Referentially stable per input, so rows
 * can put the result straight into style arrays without churning memoized children.
 */
export function resolvePageRowMetrics(input: Readonly<{ density: PageRowDensity; shape: PageRowShape; touch: boolean }>): PageRowMetrics {
    const key = `${input.density}:${input.shape}:${input.touch ? 1 : 0}`;
    const cached = resolvedPageRowMetrics.get(key);
    if (cached) return cached;
    const table = PAGE_ROW_DENSITY_METRICS[input.density];
    const box = table[input.shape];
    const metrics: PageRowMetrics = Object.freeze({
        minHeightPx: input.touch ? Math.max(box.minHeightPx, PAGE_ROW_TOUCH_MIN_HEIGHT_PX) : box.minHeightPx,
        paddingVerticalPx: box.paddingVerticalPx,
        title: table.title,
        subtitle: Object.freeze({ ...table.subtitle, marginTop: PAGE_ROW_SUBTITLE_GAP_PX }),
        iconGlyphPx: table.iconGlyphPx,
    });
    resolvedPageRowMetrics.set(key, metrics);
    return metrics;
}

/** The page shape of a resolved item density: its scale, and whether a section asked for a list. */
export function resolvePageRowDensityInput(input: Readonly<{
    preferred: PageRowDensity;
    requested: ResolvedItemDensity;
    requestedExplicitly: boolean;
}>): Readonly<{ density: PageRowDensity; shape: PageRowShape }> {
    const shape: PageRowShape = input.requestedExplicitly && (input.requested === 'compact' || input.requested === 'tight') ? 'list' : 'standard';
    return { density: input.preferred, shape };
}

/** Whether the primary pointer is a finger (the shared target-size owner decides). */
export function isTouchPrimaryPointer(): boolean {
    return isSharedTouchPrimaryPointer();
}

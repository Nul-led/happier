/**
 * Geometry of the configuration-page list anatomy (see `listPresentation.tsx`).
 *
 * The one owner for the measures every page shares — the content column, the title block, the space
 * between sections, the sheet insets and the row insets — so the page title, its purpose line, every
 * section title and every sheet sit on one vertical line on every page (Settings pages, collection
 * detail panes and the settings-like pages outside Settings). Pages consume these through `PageHeader`,
 * `ItemGroup`, `Item` and `EmptyState`; a page does not add its own horizontal padding to line
 * something up.
 */
export const PAGE_LIST_METRICS = {
    /**
     * From the column's edge to a sheet's edge. On every platform the grouped list's container padding
     * plus its card margin sum to this (web 4 + 12, iOS 0 + 16; `itemGroupSpacing.ts`).
     */
    sheetInsetPx: 16,
    /** Added to the sheet inset so a heading sits just inside the sheet edge, not flush with it. */
    headingOpticalInsetPx: 2,
    /** From the column's edge to the page title, its purpose line and every section title. */
    pageTextInsetPx: 18,
    pageHeaderPaddingTopPx: 32,
    pageHeaderPaddingBottomPx: 4,
    /** Title → purpose line, and purpose → identity details / meta. */
    pageHeaderLineGapPx: 4,
    sectionGapPx: 28,
    sectionHeaderGapPx: 10,
    sheetRadiusPx: 14,
    rowPaddingHorizontalPx: 16,
    rowPaddingVerticalPx: 14,
    rowMinHeightPx: 52,
    /**
     * A page row's leading column: one icon size in a fixed column, so the titles of a section line up
     * whether a row carries a glyph, an identity mark (which may grow the column) or nothing (a row in a
     * section where another row has an icon keeps the column empty).
     */
    rowIconGlyphPx: 18,
    rowLeadingColumnPx: 20,
    rowLeadingGapPx: 12,
    /** A compact page row: one line in a long index-style list (`ItemGroup density="compact"`). */
    compactRowPaddingVerticalPx: 9,
    compactRowMinHeightPx: 40,
    /**
     * Below this measured row width a wide accessory (segmented control, visual picker, field) moves
     * under the label. It is the width at which a ~200px label column and a ~280px control column still
     * fit side by side with their gutters; narrower than that the label would wrap word by word.
     */
    rowStackBelowWidthPx: 520,
    /** Between the back arrow in the gutter and the content's left edge. */
    backGutterGapPx: 12,
    /**
     * The room the back arrow needs left of the content's edge to sit in the gutter: the control
     * (a 20px glyph with its 4px sides), the gap to the content, and a margin from the pane's edge.
     */
    backGutterWidthPx: 28 + 12 + 8,
} as const;

export type PageBackPlacement = 'gutter' | 'title-row';

/**
 * Where a page header's back arrow goes: in the gutter left of the content column when the pane
 * leaves room for it there, otherwise on the title row. `null` until the pane has been measured, so
 * the arrow is never drawn in one place and then moved.
 */
export function resolvePageBackPlacement(input: Readonly<{
    paneWidthPx: number | null;
    columnMaxWidthPx: number;
}>): PageBackPlacement | null {
    if (input.paneWidthPx === null || !Number.isFinite(input.paneWidthPx) || input.paneWidthPx <= 0) return null;
    const columnWidthPx = Math.min(input.paneWidthPx, input.columnMaxWidthPx);
    const leadingSpacePx = (input.paneWidthPx - columnWidthPx) / 2 + PAGE_LIST_METRICS.pageTextInsetPx;
    return leadingSpacePx >= PAGE_LIST_METRICS.backGutterWidthPx ? 'gutter' : 'title-row';
}

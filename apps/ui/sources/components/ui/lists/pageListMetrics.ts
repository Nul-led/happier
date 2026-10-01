import {
    HAPPIER_PAGE_METRICS,
    resolveHappierPageBackPlacement,
    type HappierPageBackPlacement,
} from '@happier-dev/plugin-ui/presentation';

/**
 * Geometry of the configuration-page list anatomy (see `listPresentation.tsx`).
 *
 * The values are owned by the shared presentation layer (`HAPPIER_PAGE_METRICS`), so a plugin page
 * built from the public `PageHeader`/`ItemGroup`/`Item` lines up with Happier's own pages to the
 * pixel. Core pages consume them through `PageHeader`, `ItemGroup`, `Item` and `EmptyState`; a page
 * does not add its own horizontal padding to line something up.
 */
export const PAGE_LIST_METRICS = HAPPIER_PAGE_METRICS;

export type PageBackPlacement = HappierPageBackPlacement;

/**
 * Where a page header's back arrow goes: in the gutter left of the content column when the pane
 * leaves room for it there, otherwise on the title row. `null` until the pane has been measured.
 */
export const resolvePageBackPlacement = resolveHappierPageBackPlacement;


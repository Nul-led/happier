import { describe, expect, it } from 'vitest';
import { HAPPIER_COLLECTION_LIST_METRICS, HAPPIER_COLLECTION_LIST_TEXT } from '@happier-dev/plugin-ui/presentation';

import { ITEM_ICON_BOX_SIZE, ITEM_ICON_MARGIN_RIGHT, ITEM_TITLE_TEXT_METRICS } from '@/components/ui/lists/itemDensityMetrics';

/**
 * Core navigation rows are compact `Item`s; a plugin's `NavigationList.Row` is drawn by plugin-ui's
 * row owner from the list anatomy's metrics. The two must land glyphs and titles on the same x and
 * the same type step, or a plugin column visibly drifts from the Settings and Plugins columns.
 */
describe('navigation row parity between core and the plugin list anatomy', () => {
    it('shares the compact row glyph column, gap and title step', () => {
        expect(HAPPIER_COLLECTION_LIST_METRICS.rowGlyphBox).toBe(ITEM_ICON_BOX_SIZE.compact);
        expect(HAPPIER_COLLECTION_LIST_METRICS.rowGlyphGap).toBe(ITEM_ICON_MARGIN_RIGHT.compact);
        expect(HAPPIER_COLLECTION_LIST_TEXT.rowTitle.fontSize).toBe(ITEM_TITLE_TEXT_METRICS.compact.fontSize);
        expect(HAPPIER_COLLECTION_LIST_TEXT.rowTitle.lineHeight).toBe(ITEM_TITLE_TEXT_METRICS.compact.lineHeight);
    });
});

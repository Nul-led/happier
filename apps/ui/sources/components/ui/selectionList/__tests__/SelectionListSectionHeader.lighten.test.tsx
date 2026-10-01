import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

/**
 * R13 — Premium UI gaps round 2 (Fix 4): the R6 section header was still too
 * heavy for the command-bar aesthetic — 0.5pt letter-spacing + a 1pt
 * full-width top border made it read like a settings group header. The final
 * contract avoids heavy style chrome:
 *   - Sentence-case title text (U8.5 craft S1: no uppercase eyebrows) without letter-spacing
 *   - No letter-spacing on the title
 *   - No full-width border (the border, if present at all, is inset)
 *   - Smaller font (~11px on web)
 *   - Secondary text color (theme.colors.text.secondary)
 *
 * The R6 contract (testID, count rendering) MUST still hold.
 */
describe('SelectionListSectionHeader — R13 lightening', () => {
    it('renders the title in its own (sentence) case without letter-spacing', async () => {
        const { SelectionListSectionHeader } = await import('../SelectionListSectionHeader');
        const screen = await renderScreen(
            <SelectionListSectionHeader testID="hdr" title="Recent sessions" />,
        );
        const text = screen.getTextContent();
        expect(text).toContain('Recent sessions');
        expect(text).not.toContain('RECENT SESSIONS');
        // Walk the rendered tree to find any Text descendant that might carry
        // the offending styles.
        const root = screen.findByTestId('hdr');
        expect(root).not.toBeNull();
        const all = (screen.tree.root as any).findAll(() => true);
        for (const node of all) {
            const styles = node.props?.style;
            if (!styles) continue;
            const flat = (Array.isArray(styles) ? styles.flat(Infinity) : [styles]).filter(Boolean);
            for (const styleEntry of flat) {
                if (typeof styleEntry !== 'object') continue;
                const ls = (styleEntry as Record<string, unknown>).letterSpacing;
                if (typeof ls === 'number' && ls > 0) {
                    throw new Error(
                        `Found letterSpacing > 0 (${ls}) in SelectionListSectionHeader subtree`,
                    );
                }
            }
        }
    });

    it('does NOT render a full-width 1pt border on the container (web)', async () => {
        const { SelectionListSectionHeader } = await import('../SelectionListSectionHeader');
        const screen = await renderScreen(
            <SelectionListSectionHeader testID="hdr" title="Favorites" />,
        );
        const container = screen.findByTestId('hdr');
        expect(container).not.toBeNull();
        const styles = container!.props.style;
        const flat = (Array.isArray(styles) ? styles.flat(Infinity) : [styles]).filter(Boolean);
        const merged = Object.assign({}, ...flat);
        // R13 removes the full-width borderTop from R6.
        expect(merged.borderTopWidth ?? 0).toBe(0);
    });

    it('renders a smaller font size (<= 12px) on web', async () => {
        const { SelectionListSectionHeader } = await import('../SelectionListSectionHeader');
        const screen = await renderScreen(
            <SelectionListSectionHeader testID="hdr" title="Favorites" />,
        );
        const all = (screen.tree.root as any).findAll(() => true);
        const fontSizes: number[] = [];
        for (const node of all) {
            const styles = node.props?.style;
            if (!styles) continue;
            const flat = (Array.isArray(styles) ? styles.flat(Infinity) : [styles]).filter(Boolean);
            for (const styleEntry of flat) {
                if (typeof styleEntry !== 'object') continue;
                const fontSize = (styleEntry as Record<string, unknown>).fontSize;
                if (typeof fontSize === 'number') fontSizes.push(fontSize);
            }
        }
        // At least one Text node must use fontSize <= 12 (R13 target ~11).
        expect(fontSizes.length).toBeGreaterThan(0);
        expect(Math.min(...fontSizes)).toBeLessThanOrEqual(12);
    });

    it('preserves the R6 testID + count contract', async () => {
        const { SelectionListSectionHeader } = await import('../SelectionListSectionHeader');
        const screen = await renderScreen(
            <SelectionListSectionHeader testID="hdr" title="Favorites" count={3} />,
        );
        expect(screen.findByTestId('hdr')).not.toBeNull();
        const text = screen.getTextContent();
        expect(text).toContain('Favorites');
        expect(text).toContain('3');
    });

    it('keeps a section-owned action at the right edge of the shared header', async () => {
        const { SelectionListSectionHeader } = await import('../SelectionListSectionHeader');
        const screen = await renderScreen(
            <SelectionListSectionHeader
                testID="hdr"
                title="Ready for review"
                rightAccessory={React.createElement('SectionAction', { testID: 'section-action' })}
            />,
        );

        expect(screen.findByTestId('section-action')).not.toBeNull();
    });

});

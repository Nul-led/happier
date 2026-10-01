import React from 'react';
import type { ReactTestInstance } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flattenTestStyle, renderScreen } from '@/dev/testkit';
import { installUiListsCommonModuleMocks } from '../uiListsTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installUiListsCommonModuleMocks();

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroupSelectionContext: React.createContext(null),
}));

vi.mock('@/components/ui/lists/ItemGroupRowPosition', () => ({
    useItemGroupRowPosition: () => 'middle',
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
}));

vi.mock('expo-clipboard', () => ({
    setStringAsync: vi.fn(),
}));

vi.mock('@/sync/store/hooks', () => ({
    useLocalSetting: (key: string) => {
        if (key === 'uiItemDensity') return 'cozy';
        if (key === 'uiFontScale') return 1;
        return null;
    },
}));

afterEach(() => {
    vi.resetModules();
});

type Style = Record<string, unknown>;

function nearestHostView(node: ReactTestInstance): ReactTestInstance {
    let parent = node.parent;
    while (parent && (parent.type as unknown) !== 'View') parent = parent.parent;
    if (!parent) throw new Error('Expected a host View around the node');
    return parent;
}

function hostByTestID(screen: { findAllByTestId: (id: string) => ReactTestInstance[] }, testID: string) {
    const node = screen.findAllByTestId(testID).find((candidate) => typeof candidate.type === 'string');
    if (!node) throw new Error(`Missing host node ${testID}`);
    return node;
}

function bottomPadding(style: Style): unknown {
    return style.paddingBottom ?? style.paddingVertical ?? style.padding ?? 0;
}

const LAYOUT_KEYS = ['maxWidth', 'marginLeft', 'alignSelf', 'flexDirection', 'alignItems'] as const;

function layoutOf(style: Style): Style {
    return Object.fromEntries(LAYOUT_KEYS.map((key) => [key, style[key]]));
}

async function renderPageRow(props: Readonly<{ split: boolean; accessoryLayout: 'stacked' | 'inline' }>) {
    const { Item } = await import('../Item');
    const { ListPresentationProvider } = await import('../listPresentation');
    const { View } = await import('react-native');
    return renderScreen(
        <ListPresentationProvider value="page">
            <Item
                testID="row"
                title="Source"
                onPress={() => {}}
                accessoryLayout={props.accessoryLayout}
                rightElementOutsidePressable={props.split}
                rightElement={<View testID="control" />}
            />
        </ListPresentationProvider>,
    );
}

describe('Item page accessory layout', () => {
    it('stacks a split row control under the label exactly like an ordinary stacked row', async () => {
        const ordinary = await renderPageRow({ split: false, accessoryLayout: 'stacked' });
        const ordinaryAccessory = flattenTestStyle(nearestHostView(hostByTestID(ordinary, 'control')).props.style);
        const ordinaryRow = flattenTestStyle(nearestHostView(nearestHostView(hostByTestID(ordinary, 'control'))).props.style);

        vi.resetModules();
        const split = await renderPageRow({ split: true, accessoryLayout: 'stacked' });
        const splitAccessory = flattenTestStyle(nearestHostView(hostByTestID(split, 'control')).props.style);

        // The control spans the row (no half-width cap, no inset) ...
        expect(layoutOf(splitAccessory)).toEqual(layoutOf(ordinaryAccessory));
        // ... and keeps the row's bottom padding instead of sitting on the divider.
        expect(bottomPadding(splitAccessory)).toBe(bottomPadding(ordinaryRow));
        expect(bottomPadding(splitAccessory)).not.toBe(0);
    });

    it('keeps an inline split row control beside the label', async () => {
        const split = await renderPageRow({ split: true, accessoryLayout: 'inline' });
        const splitAccessory = flattenTestStyle(nearestHostView(hostByTestID(split, 'control')).props.style);
        expect(splitAccessory.flexDirection).toBe('row');
        expect(splitAccessory.maxWidth).toBe('50%');
    });
});

describe('Item leading mark on a page', () => {
    async function leadingBox(presentation: 'page' | 'grouped') {
        const { Item } = await import('../Item');
        const { ListPresentationProvider } = await import('../listPresentation');
        const { View } = await import('react-native');
        const screen = await renderScreen(
            <ListPresentationProvider value={presentation}>
                <Item title="Ada Lovelace" leftElement={<View testID="avatar" style={{ width: 36, height: 36 }} />} />
            </ListPresentationProvider>,
        );
        return flattenTestStyle(nearestHostView(hostByTestID(screen, 'avatar')).props.style);
    }

    it('grows the leading box to a mark larger than the density glyph box, so it does not overhang the sheet edge', async () => {
        const box = await leadingBox('page');
        // The box sizes to the 36px mark; the density box is only its minimum.
        expect(box.width).toBe('auto');
        expect(typeof box.minWidth).toBe('number');
        expect(box.minWidth as number).toBeLessThan(36);
    });

    it('keeps the fixed glyph box outside page presentation (menus, pickers)', async () => {
        vi.resetModules();
        const box = await leadingBox('grouped');
        expect(typeof box.width).toBe('number');
    });
});

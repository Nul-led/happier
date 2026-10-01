import * as React from 'react';
import renderer from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { installDropdownCommonModuleMocks } from './dropdownTestHelpers';
import { collectUnexpectedRawTextNodes, renderScreen, withPopoverWebGlobals } from '@/dev/testkit';


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createDropdownOverlayReactNativeModuleMock = async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');

    return createReactNativeWebMock({
        View: 'View',
        Text: 'Text',
        TextInput: 'TextInput',
        Pressable: 'Pressable',
        ActivityIndicator: 'ActivityIndicator',
        Dimensions: {
            get: () => ({ width: 1280, height: 800, scale: 1, fontScale: 1 }),
        },
    });
};

const createDropdownOverlayModalModuleMock = async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');

    return createModalModuleMock({
        spies: {
            alert: vi.fn(),
            prompt: vi.fn(async () => null),
        },
    }).module;
};

installDropdownCommonModuleMocks({
    reactNative: createDropdownOverlayReactNativeModuleMock,
    modal: createDropdownOverlayModalModuleMock,
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: () => <>{'.'}</>,
}));

vi.mock('expo-clipboard', () => ({
    setStringAsync: vi.fn(async () => {}),
}));

describe('DropdownMenu overlay text node guard', () => {
    it('does not emit raw period text nodes under non-Text parents when the live overlay path is rendered', async () => {
        const { DropdownMenu } = await import('./DropdownMenu');

        const items = [
            {
                id: '__refresh_models__',
                title: 'Refresh models',
                subtitle: 'Fetch the latest model list.',
                icon: null,
            },
            {
                id: 'default',
                title: 'Use CLI settings',
                icon: null,
            },
            {
                id: '__custom__',
                title: 'Custom…',
                subtitle: 'Enter a model id',
                icon: null,
            },
        ];

        // The real web popover measures against `window`; the testkit owns those globals.
        await withPopoverWebGlobals(async () => {
        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<DropdownMenu
                    open={true}
                    onOpenChange={() => {}}
                    items={items}
                    onSelect={() => {}}
                    search={true}
                    searchPlaceholder="Search models"
                    rowKind="item"
                    showCategoryTitles={false}
                    selectedId="gpt-5.3-codex-spark/medium"
                    itemTrigger={{
                        title: 'Voice agent chat model id',
                        subtitleFormatter: () => 'Used when the voice agent chat model source is set to Custom model.',
                        detailFormatter: () => 'gpt-5.3-codex-spark/medium',
                    }}
                />)).tree;

        expect(collectUnexpectedRawTextNodes(tree.toJSON())).toEqual([]);
        });
    });
});

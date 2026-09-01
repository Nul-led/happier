import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { createCapturingComponent } from '@/dev/testkit/mocks/components';

const capturedGroups: Array<Record<string, unknown>> = [];
const capturedItems: Array<Record<string, unknown>> = [];

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: createCapturingComponent('ItemGroup', (props) => capturedGroups.push(props)),
}));
vi.mock('@/components/ui/lists/Item', () => ({
    Item: createCapturingComponent('Item', (props) => capturedItems.push(props)),
}));
describe('ConnectionTargetList', () => {
    beforeEach(() => {
        capturedGroups.length = 0;
        capturedItems.length = 0;
    });

    it('projects Home targets through the canonical radio-group semantics', async () => {
        const { ConnectionTargetList } = await import('./ConnectionTargetList');
        await renderScreen(<ConnectionTargetList
            title="Homes"
            accessibilityLabel="Choose a Home"
            actions={[
                {
                    id: 'home-a',
                    label: 'Home A',
                    subtitle: 'Connected',
                    accessibilityLabel: 'Home A, Connected',
                    selected: true,
                    disabled: true,
                    right: React.createElement('Check'),
                    onPress: () => {},
                },
                {
                    id: 'home-b',
                    label: 'Home B',
                    subtitle: 'Offline',
                    accessibilityLabel: 'Home B, Offline',
                    selected: false,
                    onPress: () => {},
                },
            ]}
        />);

        expect(capturedGroups.at(-1)).toMatchObject({
            accessibilityRole: 'radiogroup',
            accessibilityLabel: 'Choose a Home',
            selectableItemCountOverride: 2,
        });
        expect(capturedItems.map((item) => ({
            title: item.title,
            accessibilityRole: item.accessibilityRole,
            accessibilityLabel: item.accessibilityLabel,
            selected: item.selected,
            disabled: item.disabled,
            showChevron: item.showChevron,
        }))).toEqual([
            {
                title: 'Home A',
                accessibilityRole: 'radio',
                accessibilityLabel: 'Home A, Connected',
                selected: true,
                disabled: true,
                showChevron: false,
            },
            {
                title: 'Home B',
                accessibilityRole: 'radio',
                accessibilityLabel: 'Home B, Offline',
                selected: false,
                disabled: undefined,
                showChevron: false,
            },
        ]);
    });
});

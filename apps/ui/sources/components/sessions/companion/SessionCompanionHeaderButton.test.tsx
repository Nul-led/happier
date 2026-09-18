import * as React from 'react';
import { Platform } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { flattenTestStyle } from '@/dev/testkit/harness/popoverHarness';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

import { SessionCompanionHeaderButton } from './SessionCompanionHeaderButton';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SessionCompanionHeaderButton', () => {
    it('projects the shared intent without owning placement or execution', async () => {
        const onPress = vi.fn();
        const renderer = await renderScreen(
            <SessionCompanionHeaderButton
                intent={{
                    operation: 'expand',
                    accessibility: 'expand',
                    itemCount: 2,
                    expanded: false,
                    checked: true,
                }}
                onPress={onPress}
            />,
        );
        const action = renderer.findByTestId('session-header-companion');

        expect(action?.props.accessibilityRole).toBe('button');
        expect(action?.props.accessibilityLabel).toBe('sessionBoard.companion.a11y.expand(count=2)');
        expect(action?.props.accessibilityState).toEqual({ expanded: false });
        action?.props.onPress();
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('uses the canonical Android physical target without overlapping hit slop', async () => {
        const previousPlatform = Platform.OS;
        (Platform as { OS: string }).OS = 'android';
        try {
            const renderer = await renderScreen(
                <SessionCompanionHeaderButton
                    intent={{
                        operation: 'open_full',
                        accessibility: 'open_full',
                        itemCount: 4,
                        expanded: false,
                        checked: true,
                    }}
                    onPress={() => undefined}
                />,
            );
            const action = renderer.findByTestId('session-header-companion');
            const style = flattenTestStyle(action?.props.style({ pressed: false }));

            expect(style.width).toBe(resolveMinimumInteractiveTargetSize('android'));
            expect(style.height).toBe(resolveMinimumInteractiveTargetSize('android'));
            expect(action?.props.hitSlop).toBeUndefined();
            expect(action?.props.accessibilityLabel)
                .toBe('sessionBoard.companion.actions.openFull. sessionBoard.companion.a11y.headerAction(count=4)');
        } finally {
            (Platform as { OS: string }).OS = previousPlatform;
        }
    });
});

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import { installAvatarCommonModuleMocks } from './avatarTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installAvatarCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: (props: React.ComponentProps<'div'>) => React.createElement('View', props, props.children),
            Text: (props: React.ComponentProps<'span'>) => React.createElement('Text', props, props.children),
        });
    },
    storage: async () => {
        const { createStorageModuleStub, createUseSettingMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSetting: createUseSettingMock({
                values: {
                    avatarStyle: 'gradient',
                    showFlavorIcons: false,
                },
            }),
        });
    },
});

vi.mock('./AvatarGradient', () => ({
    AvatarGradient: (props: Record<string, unknown>) => React.createElement('AvatarGradient', props),
}));

describe('Avatar monogram presentation', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('adds a deterministic first-grapheme monogram over the generated identity', async () => {
        const { Avatar } = await import('./Avatar');
        const screen = await renderScreen(<Avatar id="équipe-1" title square size={48} />);

        const monogram = screen.findByTestId('avatar-monogram');
        expect(monogram).not.toBeNull();
        expect(monogram?.props.children).toBe('É');
        expect(screen.tree.root.findAllByType('AvatarGradient' as never)).toHaveLength(1);
    });

    it('does not cover a published image with the generated monogram', async () => {
        const { Avatar } = await import('./Avatar');
        const screen = await renderScreen(
            <Avatar id="team-1" title imageUrl="https://example.test/logo.png" square size={48} />,
        );

        expect(screen.findByTestId('avatar-monogram')).toBeNull();
    });
});

import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => `en:${key}` });
});

describe('RightSidebarActionRail', () => {
    it('separates the code, session and machine groups with one hairline each, keeping the given order', async () => {
        const { RightSidebarActionRail } = await import('./RightSidebarActionRail');
        const action = (id: string, group: string) => ({
            id, group, label: id, icon: 'folder' as const, active: false, onPress: () => {},
        });
        const screen = await renderScreen(
            <RightSidebarActionRail
                testIDPrefix="rail"
                actions={[
                    action('git', 'code'), action('review', 'code'), action('files', 'code'),
                    action('agents', 'session'), action('navigation', 'session'),
                    action('services', 'machine'), action('terminal', 'machine'),
                ]}
            />,
        );

        const order = screen.findAll((node) => typeof node.type === 'string'
            && typeof node.props.testID === 'string'
            && /^rail:(git|review|files|agents|navigation|services|terminal|separator:\w+)$/.test(node.props.testID))
            .map((node) => node.props.testID as string)
            .filter((id, index, all) => all.indexOf(id) === index);
        expect(order).toEqual([
            'rail:git', 'rail:review', 'rail:files',
            'rail:separator:session',
            'rail:agents', 'rail:navigation',
            'rail:separator:machine',
            'rail:services', 'rail:terminal',
        ]);
    });
});

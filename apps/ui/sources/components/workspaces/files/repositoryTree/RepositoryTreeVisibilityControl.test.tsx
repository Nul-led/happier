import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({ theme: { colors: { text: { secondary: '#666' } } } });
});
vi.mock('@/components/ui/navigation/SegmentedTabBar', () => ({
    SegmentedTabBar: (props: unknown) => React.createElement('SegmentedTabBar', props as Record<string, unknown>),
}));
vi.mock('@/components/ui/text/Text', () => ({ Text: 'Text' }));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

import { RepositoryTreeVisibilityControl } from './RepositoryTreeVisibilityControl';

describe('RepositoryTreeVisibilityControl', () => {
    it('does not offer Project while ignore classification is unavailable', async () => {
        const onChange = vi.fn();
        const screen = await renderScreen(<RepositoryTreeVisibilityControl mode="project" available={false} onChange={onChange} />);
        const bar = screen.findAllByType('SegmentedTabBar')[0];
        expect(bar.props.activeTabId).toBe('all');
        expect(bar.props.tabs.find((tab: { id: string }) => tab.id === 'project').disabled).toBe(true);
        expect(screen.findByTestId('repository-tree-project-unavailable')).toBeTruthy();
    });
});

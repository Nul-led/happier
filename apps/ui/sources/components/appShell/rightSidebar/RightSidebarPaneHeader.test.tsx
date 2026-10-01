import * as React from 'react';
import { act } from 'react-test-renderer';
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

function textOf(node: { children: unknown[] } | null): string {
    if (!node) return '';
    return node.children.map((child) => (typeof child === 'string' ? child : textOf(child as { children: unknown[] }))).join('');
}

describe('RightSidebarPaneHeader', { timeout: 240_000 }, () => {
    it('shows the live line and next step of the active tab only, from what each tab publishes', async () => {
        const { RightSidebarPaneHeader } = await import('./RightSidebarPaneHeader');
        const { resolveRightSidebarTabs } = await import('./rightSidebarTabRegistry');
        const { PaneHeaderSlotProvider, PaneHeaderSlotScope, usePaneHeaderSlotContent } = await import('@/components/appShell/panes/paneHeaderSlot');
        const tabs = resolveRightSidebarTabs({ scope: 'session', presentation: 'desktop' });

        function GitBody() {
            const action = React.useMemo(() => <React.Fragment key="push">Push 2</React.Fragment>, []);
            usePaneHeaderSlotContent({ line: { segments: [{ text: 'v0.3', emphasis: true }, '14 changed', '2 to push'] }, action });
            return null;
        }
        function FilesBody() {
            usePaneHeaderSlotContent({ line: { segments: ['happier on MacBook Pro', '14 changed'] } });
            return null;
        }
        let selectTab: (tabId: string) => void = () => {};
        function Panel() {
            const [active, setActive] = React.useState('git');
            selectTab = setActive;
            return (
                <PaneHeaderSlotProvider>
                    <RightSidebarPaneHeader tabs={tabs} activeTabId={active} testID="pane" />
                    <PaneHeaderSlotScope slotKey="git"><GitBody /></PaneHeaderSlotScope>
                    <PaneHeaderSlotScope slotKey="files"><FilesBody /></PaneHeaderSlotScope>
                </PaneHeaderSlotProvider>
            );
        }

        const screen = await renderScreen(<Panel />);
        expect(textOf(screen.findHostByTestId('pane.subtitle') as never)).toBe('v0.3 · 14 changed · 2 to push');
        expect(textOf(screen.findHostByTestId('pane') as never)).toContain('Push 2');

        await act(async () => { selectTab('files'); });
        expect(textOf(screen.findHostByTestId('pane.subtitle') as never)).toBe('happier on MacBook Pro · 14 changed');
        expect(textOf(screen.findHostByTestId('pane') as never)).not.toContain('Push 2');
    });

    it('draws no live line for a tab that publishes nothing', async () => {
        const { RightSidebarPaneHeader } = await import('./RightSidebarPaneHeader');
        const { resolveRightSidebarTabs } = await import('./rightSidebarTabRegistry');
        const { PaneHeaderSlotProvider } = await import('@/components/appShell/panes/paneHeaderSlot');
        const tabs = resolveRightSidebarTabs({ scope: 'session', presentation: 'desktop' });

        const screen = await renderScreen(
            <PaneHeaderSlotProvider>
                <RightSidebarPaneHeader tabs={tabs} activeTabId="files" testID="pane" />
            </PaneHeaderSlotProvider>,
        );
        expect(screen.findHostByTestId('pane.title')).not.toBeNull();
        expect(screen.findHostByTestId('pane.subtitle')).toBeNull();
    });

    it('shows what a plugin tab publishes through the plugin-ui pane header binding, and nothing outside a header', async () => {
        const { RightSidebarPaneHeader } = await import('./RightSidebarPaneHeader');
        const { resolveRightSidebarTabs } = await import('./rightSidebarTabRegistry');
        const { PaneHeaderSlotProvider, PaneHeaderSlotScope, usePaneHeaderSlotBinding } = await import('@/components/appShell/panes/paneHeaderSlot');
        const { View } = await import('react-native');
        const tabs = resolveRightSidebarTabs({ scope: 'session', presentation: 'desktop' });

        // The binding a plugin mount receives: what `PaneHeaderContent` calls from inside the plugin tree.
        function PluginTab() {
            const binding = usePaneHeaderSlotBinding();
            if (binding === null) return <View testID="no-binding" />;
            return <>{binding.renderPaneHeader({ line: ['1 needs you'], actions: <React.Fragment key="plus">Link a PR</React.Fragment> })}</>;
        }

        const screen = await renderScreen(
            <PaneHeaderSlotProvider>
                <RightSidebarPaneHeader tabs={tabs} activeTabId="files" testID="pane" />
                <PaneHeaderSlotScope slotKey="files"><PluginTab /></PaneHeaderSlotScope>
            </PaneHeaderSlotProvider>,
        );
        expect(textOf(screen.findHostByTestId('pane.subtitle') as never)).toBe('1 needs you');
        expect(textOf(screen.findHostByTestId('pane') as never)).toContain('Link a PR');

        const bare = await renderScreen(<PluginTab />);
        expect(bare.findHostByTestId('no-binding')).not.toBeNull();
    });
});

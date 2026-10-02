import * as React from 'react';
import { View } from 'react-native';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { installPanelCommonModuleMocks } from '@/components/ui/panels/panelTestHelpers';
import { DocumentTabStrip } from './DocumentTabStrip';

installPanelCommonModuleMocks();

describe('DocumentTabStrip actions', () => {
    it.each(['bar', 'strip'] as const)('keeps pinned needs-you status visible and named in the %s presentation', async (variant) => {
        const screen = await renderScreen(<DocumentTabStrip
            variant={variant}
            tabs={[{ key: 'session', title: 'Fix layout', isPinned: true, isPreview: false }]}
            activeTabKey="session" accessibilityLabel="Workspace"
            onActivate={() => {}} onPin={() => {}} onUnpin={() => {}} onClose={() => {}}
            renderLeadingIcon={() => null} tabNativeId={(id) => `tab-${id}`} panelNativeId={(id) => `panel-${id}`}
            resolveTabPresentation={() => ({ status: { tone: 'attention', label: 'Needs you' } })}
            testIds={{ tab: (id) => `tab-${id}`, tabStatus: (id) => `status-${id}` }}
        />);
        expect(screen.findHostByTestId('status-session')).toBeTruthy();
        expect(screen.findByTestId('tab-session')?.props.accessibilityLabel).toContain('Needs you');
    });

    it('keeps the Agent mark beside a background working spinner and the active close action', async () => {
        const screen = await renderScreen(<DocumentTabStrip
            variant="bar"
            tabs={[{ key: 'active', title: 'Open session', isPinned: false, isPreview: false }, { key: 'background', title: 'Working session', isPinned: false, isPreview: false }]}
            activeTabKey="active" accessibilityLabel="Workspace"
            onActivate={() => {}} onPin={() => {}} onUnpin={() => {}} onClose={() => {}}
            renderLeadingIcon={(tab) => <View testID={`agent-${tab.key}`} />}
            tabNativeId={(id) => `tab-${id}`} panelNativeId={(id) => `panel-${id}`}
            resolveTabPresentation={() => ({ status: { tone: 'working', label: 'Working' } })}
            testIds={{ tab: (id) => `tab-${id}`, tabSpinner: (id) => `spinner-${id}`, tabClose: (id) => `close-${id}` }}
        />);
        expect(screen.findHostByTestId('spinner-background')).toBeTruthy();
        expect(screen.findHostByTestId('spinner-active')).toBeFalsy();
        expect(screen.findByTestId('close-active')).toBeTruthy();
        expect(screen.findHostByTestId('agent-background')).toBeTruthy();
    });

    it('identifies each tab in its action names and preserves pin, unpin and unsaved close intent', async () => {
        const pin = vi.fn();
        const unpin = vi.fn();
        const close = vi.fn();
        const screen = await renderScreen(<DocumentTabStrip
            tabs={[
                { key: 'a', title: 'Alpha', isPinned: false, isPreview: true },
                { key: 'b', title: 'Beta', isPinned: true, isPreview: false },
            ]}
            activeTabKey="a" accessibilityLabel="Documents"
            onActivate={() => {}} onPin={pin} onUnpin={unpin} onClose={close}
            renderLeadingIcon={() => null} tabNativeId={(id) => `tab-${id}`} panelNativeId={(id) => `panel-${id}`}
            unsavedTabKeys={new Set(['b'])}
            testIds={{ tabPin: (id) => `pin-${id}`, tabUnpin: (id) => `unpin-${id}`, tabClose: (id) => `close-${id}` }}
        />);
        const pinButton = screen.findByTestId('pin-a');
        const unpinButton = screen.findByTestId('unpin-b');
        const closeButton = screen.findByTestId('close-b');
        expect(pinButton?.props.accessibilityLabel).toContain('Alpha');
        expect(unpinButton?.props.accessibilityLabel).toContain('Beta');
        expect(closeButton?.props.accessibilityLabel).toContain('Beta');
        expect(closeButton?.props.accessibilityLabel).toContain('closeUnsavedTabA11y');
        await act(async () => {
            pinButton?.props.onPress({ stopPropagation() {} });
            unpinButton?.props.onPress({ stopPropagation() {} });
            closeButton?.props.onPress({ stopPropagation() {} });
        });
        expect(pin).toHaveBeenCalledWith('a');
        expect(unpin).toHaveBeenCalledWith('b');
        expect(close).toHaveBeenCalledWith('b');
    });

    it('shows a tab\'s live status in its trailing slot and keeps close on the open tab without one (terminal lab B1)', async () => {
        const screen = await renderScreen(<DocumentTabStrip
            variant="bar"
            tabs={[
                { key: 'zsh', title: 'zsh', isPinned: false, isPreview: false },
                { key: 'vite', title: 'vite', isPinned: false, isPreview: false },
                { key: 'claude', title: 'Claude', isPinned: false, isPreview: false },
            ]}
            activeTabKey="zsh" accessibilityLabel="Terminals"
            onActivate={() => {}} onPin={() => {}} onUnpin={() => {}} onClose={() => {}}
            renderLeadingIcon={() => null} tabNativeId={(id) => `tab-${id}`} panelNativeId={(id) => `panel-${id}`}
            resolveTabPresentation={(tab) => tab.key === 'vite' ? { status: { tone: 'running', label: 'Running' } }
                : tab.key === 'claude' ? { status: { tone: 'attention', label: 'Needs you' } } : null}
            testIds={{ tab: (id) => `tab-${id}`, tabClose: (id) => `close-${id}`, tabStatus: (id) => `status-${id}` }}
        />);
        expect(screen.findByTestId('close-zsh')).toBeTruthy();
        expect(screen.findByTestId('status-zsh')).toBeFalsy();
        expect(screen.findByTestId('status-vite')).toBeTruthy();
        expect(screen.findByTestId('close-vite')).toBeFalsy();
        expect(screen.findByTestId('tab-claude')?.props.accessibilityLabel).toContain('Needs you');
    });
});

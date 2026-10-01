import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import { installNavigationShellCommonModuleMocks } from '../navigationShellTestHelpers';

// The real local-settings store: hiding the switch is a device-local preference the strip must obey.
installNavigationShellCommonModuleMocks({ storage: (importOriginal) => importOriginal() });

vi.mock('@/components/inbox/actionOperations/ActionOperationActivityButton', () => ({
    ActionOperationActivityButton: () => null,
}));
// The popover's portal/measurement boundary renders the open menu inline; the menu itself is real.
vi.mock('@/components/ui/popover', async (importOriginal) => {
    const { createInlinePopoverModuleMock } = await import('@/dev/testkit/mocks/popover');
    return createInlinePopoverModuleMock(importOriginal);
});

afterEach(async () => {
    const { storage } = await import('@/sync/domains/state/storage');
    act(() => { storage.getState().applyLocalSettings({ titleStripThemeToggleVisible: true }); });
    standardCleanup();
});

/** The toggle's secondary invocations, as its press owner receives them. */
function toggleWith(screen: Awaited<ReturnType<typeof renderScreen>>, handler: 'onContextMenu' | 'onLongPress') {
    const node = screen.findAllByTestId('app-shell-theme-toggle').find((candidate) => typeof candidate.props[handler] === 'function');
    expect(node).toBeDefined();
    return node?.props[handler] as ((event?: unknown) => void) | undefined;
}

async function renderStrip() {
    const { AppShellTitleStrip } = await import('./AppShellTitleStrip');
    return renderScreen(<AppShellTitleStrip columnVisible columnToggleAvailable onToggleColumn={() => {}} />);
}

describe('AppShellThemeToggle', () => {
    it('opens its menu on a long press and on a right click, and hides itself from the toolbar on request', async () => {
        const screen = await renderStrip();
        expect(screen.findByTestId('app-shell-theme-menu-hide')).toBeNull();

        await act(async () => { toggleWith(screen, 'onContextMenu')?.({ preventDefault: () => {} }); });
        expect(screen.findByTestId('app-shell-theme-menu-hide')).not.toBeNull();
        expect(screen.findByTestId('app-shell-theme-menu-adaptive')).not.toBeNull();
        await act(async () => { toggleWith(screen, 'onContextMenu')?.({ preventDefault: () => {} }); });

        await act(async () => { toggleWith(screen, 'onLongPress')?.(); });
        await screen.pressByTestIdAsync('app-shell-theme-menu-hide');
        // The menu commits a choice once it has closed (the dropdown's action frame).
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });

        const { storage } = await import('@/sync/domains/state/storage');
        expect(storage.getState().localSettings.titleStripThemeToggleVisible).toBe(false);
        expect(screen.findByTestId('app-shell-theme-toggle')).toBeNull();
    });

    it('stays out of the toolbar while the device preference hides it', async () => {
        const { storage } = await import('@/sync/domains/state/storage');
        act(() => { storage.getState().applyLocalSettings({ titleStripThemeToggleVisible: false }); });
        const screen = await renderStrip();
        expect(screen.findByTestId('app-shell-theme-toggle')).toBeNull();
        expect(screen.findByTestId('app-shell-column-toggle')).not.toBeNull();
    });
});

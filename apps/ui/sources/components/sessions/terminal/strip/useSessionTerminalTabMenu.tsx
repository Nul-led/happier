import * as React from 'react';
import type { SessionTerminalWorkspaceV1 } from '@happier-dev/protocol';
import { useUnistyles } from 'react-native-unistyles';

import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { Modal } from '@/modal';
import { t } from '@/text';
import { KeyboardShortcutLabelsContext } from '@/keyboard/shortcutLabels';

import { openSessionTerminalInDetails } from '../embeddedTerminalDocking';
import type { SessionTerminalTabDescriptor } from '../presentation/describeSessionTerminal';
import { createSessionTerminalLeafHandles } from './sessionTerminalLeafHandles';
import { buildSessionTerminalTabMenuItems, TERMINAL_MENU_GLYPH_PX } from './sessionTerminalMenus';

type Run = (actionId: 'session.terminals.focus' | 'session.terminals.split' | 'session.terminals.rename' | 'session.terminals.detach'
    | 'session.terminals.close' | 'session.terminals.close_others', input?: Readonly<Record<string, unknown>>) => unknown;

/**
 * One terminal tab's menu (terminal lab M), shared by the desktop strip and list and the phone
 * Terminal page's chips: its items and what each does. Layout verbs go through the
 * `session.terminals.*` Actions (`run`); copy, paste, clear and restart reach the mounted view
 * through `leafHandles`, which the surface provides to its terminal leaves.
 */
export function useSessionTerminalTabMenu(input: Readonly<{
    scopeId: string;
    workspace: SessionTerminalWorkspaceV1;
    tabs: readonly SessionTerminalTabDescriptor[];
    run: Run;
    /** After "Open in Details" (the desktop pane hides itself, so one view shows the terminal). */
    onOpenedInDetails?: () => void;
}>) {
    const { scopeId, workspace, tabs, run, onOpenedInDetails } = input;
    const { theme } = useUnistyles();
    const pane = useAppPaneScope(scopeId);
    const shortcutLabels = React.useContext(KeyboardShortcutLabelsContext);
    const [leafHandles] = React.useState(createSessionTerminalLeafHandles);
    const glyph = React.useCallback((name: IconName) => <Icon name={name} size={TERMINAL_MENU_GLYPH_PX} color={theme.colors.text.secondary} />, [theme.colors.text.secondary]);

    const items = React.useCallback((tabId: string) => {
        const tab = workspace.tabs.find((candidate) => candidate.id === tabId);
        const descriptor = tabs.find((candidate) => candidate.tabId === tabId);
        if (!tab || !descriptor) return [];
        const handle = leafHandles.get(tab.focusedTerminalId);
        const focused = tab.terminals.find((terminal) => terminal.id === tab.focusedTerminalId);
        return buildSessionTerminalTabMenuItems({
            tab: descriptor,
            terminalId: tab.focusedTerminalId,
            mounted: { copySelection: Boolean(handle?.copySelection), paste: Boolean(handle), clear: Boolean(handle), restart: Boolean(handle) },
            canSplit: true,
            splitShortcut: shortcutLabels['terminal.split'],
            canOpenInDetails: focused?.target.kind === 'workspace_shell',
            hasOtherTabs: workspace.tabs.length > 1,
        }, glyph);
    }, [glyph, leafHandles, shortcutLabels, tabs, workspace.tabs]);

    const select = React.useCallback((tabId: string, itemId: string) => {
        const tab = workspace.tabs.find((candidate) => candidate.id === tabId);
        if (!tab) return;
        const terminalId = tab.focusedTerminalId;
        const handle = leafHandles.get(terminalId);
        switch (itemId) {
            case 'rename': {
                const current = tabs.find((candidate) => candidate.tabId === tabId)?.members.find((member) => member.terminalId === terminalId)?.title ?? '';
                void Modal.prompt(t('terminalWorkspace.rename.title'), undefined, { defaultValue: current, placeholder: t('terminalWorkspace.rename.placeholder') })
                    .then((title) => { if (title !== null) void run('session.terminals.rename', { terminalId, title: title.trim() || null }); });
                return;
            }
            case 'splitRight':
                if (workspace.activeTabId !== tabId) void run('session.terminals.focus', { terminalId });
                return void run('session.terminals.split', { tabId, target: { kind: 'workspace_shell' } });
            case 'moveToOwnTab': return void run('session.terminals.detach', { terminalId });
            case 'openInDetails':
                openSessionTerminalInDetails(pane, terminalId);
                return onOpenedInDetails?.();
            case 'copySelection': return handle?.copySelection?.();
            case 'paste': return handle?.paste();
            case 'clear': return handle?.clear();
            case 'restart': return handle?.restart();
            case 'close': return void run('session.terminals.close', { terminalId });
            case 'closeOthers': return void run('session.terminals.close_others', { tabId });
        }
    }, [leafHandles, onOpenedInDetails, pane, run, tabs, workspace.activeTabId, workspace.tabs]);

    return React.useMemo(() => ({ items, select, leafHandles }), [items, leafHandles, select]);
}

import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';

import { useAgentInputSelectionOverlayController } from '../selection/useAgentInputSelectionOverlayController';
import { useAgentInputActionMenuControls } from './useAgentInputActionMenuControls';

vi.mock('@/components/ui/theme/haptics', () => ({
    hapticsLight: vi.fn(),
}));

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

vi.mock('@/agents/catalog/catalog', () => ({
    AGENT_IDS: ['codex', 'claude', 'opencode', 'gemini'],
    DEFAULT_AGENT_ID: 'codex',
    getAgentCore: () => ({ displayNameKey: 'agents.codex' }),
}));

describe('useAgentInputActionMenuControls', () => {
    it('opens the collapsed Agent picker when Agent options are available', async () => {
        const hook = await renderHook(() => {
            const controller = useAgentInputSelectionOverlayController({
                shouldRenderSessionModeChip: false,
                canChangePermission: false,
                hasMachinePopover: false,
                hasPathPopover: false,
                hasResumePopover: false,
                hasProfilePopover: false,
                hasEnvVarsPopover: false,
                hasAgentPickerOptions: true,
                extraActionChips: [],
            });
            return {
                ...controller,
                ...useAgentInputActionMenuControls({
                    showActionMenu: true,
                    setShowActionMenu: vi.fn(),
                    closeSelectionOverlay: controller.closeSelectionOverlay,
                    openSelectionOverlay: controller.openSelectionOverlay,
                    resetSelectionOverlays: controller.resetSelectionOverlays,
                    inputRef: { current: { blur: vi.fn() } } as React.RefObject<{ blur?: () => void } | null>,
                    hasAgentPickerOptions: true,
                    actionBarIsCollapsed: true,
                    hasAnyActions: true,
                    tint: '#fff',
                    agentId: 'codex',
                    profileLabel: null,
                    profileIcon: 'user-circle',
                    openCollapsedOptionsPopover: () => {},
                    sessionModeLabel: null,
                    sessionModeChipInteraction: null,
                    shouldExposeSessionModeAction: false,
                    canStop: false,
                    onStop: () => {},
                    hasProfile: false,
                    hasEnvVars: false,
                    hasAgent: true,
                }),
            };
        });

        await act(async () => {
            hook.getCurrent().actionMenuActions.find((action) => action.id === 'agent')?.onPress?.();
        });

        expect(hook.getCurrent().activeSelectionOverlay).toEqual({ id: 'agent', anchor: 'actionMenu' });
        await hook.unmount();
    });

    it('opens the shared path popover from the collapsed action menu path item', async () => {
        const onPathClick = vi.fn();

        const hook = await renderHook(() => {
            const controller = useAgentInputSelectionOverlayController({
                shouldRenderSessionModeChip: false,
                canChangePermission: false,
                hasMachinePopover: false,
                hasPathPopover: true,
                hasResumePopover: false,
                hasProfilePopover: false,
                hasEnvVarsPopover: false,
                hasAgentPickerOptions: false,
                extraActionChips: [],
            });

            const menu = useAgentInputActionMenuControls({
                showActionMenu: true,
                setShowActionMenu: vi.fn(),
                closeSelectionOverlay: controller.closeSelectionOverlay,
                openSelectionOverlay: controller.openSelectionOverlay,
                resetSelectionOverlays: controller.resetSelectionOverlays,
                inputRef: { current: { blur: vi.fn() } } as React.RefObject<{ blur?: () => void } | null>,
                pathPopover: { renderContent: () => null },
                hasAgentPickerOptions: false,
                onPathClick,
                actionBarIsCollapsed: true,
                hasAnyActions: true,
                tint: '#fff',
                agentId: 'codex' as never,
                profileLabel: null,
                profileIcon: 'user-circle',
                currentPath: '/repo/current',
                openCollapsedOptionsPopover: () => {},
                sessionModeLabel: null,
                sessionModeChipInteraction: null,
                shouldExposeSessionModeAction: false,
                canStop: false,
                onStop: () => {},
                onMachineClick: undefined,
                onResumeClick: undefined,
                onFileViewerPress: undefined,
                hasProfile: false,
                hasEnvVars: false,
                hasAgent: false,
            });

            return {
                ...controller,
                ...menu,
            };
        });

        const pathAction = hook.getCurrent().actionMenuActions.find((action) => action.id === 'path');
        expect(pathAction).toBeTruthy();

        await act(async () => {
            pathAction?.onPress?.();
        });

        expect(onPathClick).not.toHaveBeenCalled();
        expect(hook.getCurrent().activeSelectionOverlay).toEqual({
            id: 'path',
            anchor: 'actionMenu',
        });

        await hook.unmount();
    });
});

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { View } from 'react-native';

import { buildCollapsedExtraControlActions } from '../controls/buildCollapsedExtraControlActions';
import { createSessionAccessActionChip } from './createSessionAccessActionChip';

function renderChip(chip: ReturnType<typeof createSessionAccessActionChip>) {
    return renderScreen(<>{chip.render({
        chipStyle: () => ({}),
        showLabel: true,
        iconColor: 'black',
        textStyle: {},
        countTextStyle: {},
        chipAnchorRef: React.createRef(),
        popoverAnchorRef: React.createRef(),
        toggleCollapsedPopover: vi.fn(),
    })}</>);
}

afterEach(() => { standardCleanup(); });

describe('Session access composer entry', () => {
    it('routes compact/mobile chip presses to the incumbent screen host instead of opening a popover', async () => {
        const onOpen = vi.fn();
        const toggleCollapsedPopover = vi.fn();
        const chipAnchorRef = React.createRef<React.ComponentRef<typeof View>>();
        const chip = createSessionAccessActionChip({
            label: 'Private', accessibilityLabel: 'Manage Session access', popoverContent: () => null, onOpen,
        });
        const screen = await renderScreen(<>{chip.render({
            chipStyle: () => ({}), showLabel: true, iconColor: 'black', textStyle: {}, countTextStyle: {},
            chipAnchorRef, popoverAnchorRef: React.createRef(), toggleCollapsedPopover,
        })}</>);

        await screen.pressByTestId('session-access-chip');

        expect(onOpen).toHaveBeenCalledWith(chipAnchorRef);
        expect(toggleCollapsedPopover).not.toHaveBeenCalled();
    });

    it('opens the same lazy editor from overflow without changing message recipient', () => {
        const renderContent = vi.fn(() => null);
        const openCollapsedOptionsPopover = vi.fn();
        const chip = createSessionAccessActionChip({
            label: 'Private', accessibilityLabel: 'Manage Session access', popoverContent: renderContent,
        });
        const actions = buildCollapsedExtraControlActions({
            chips: [chip], tint: 'black', dismiss: vi.fn(), blurInput: vi.fn(), openCollapsedOptionsPopover,
        });
        expect(renderContent).not.toHaveBeenCalled();
        expect(actions.recipient).toBeUndefined();
        actions.sessionAccess?.[0]?.onPress?.();
        expect(openCollapsedOptionsPopover).toHaveBeenCalledWith(chip.key);
        expect(chip.collapsedContentPopover?.renderContent).toBe(renderContent);
    });

    it('shows the same policy lock the grant row uses when access is required by Team policy', async () => {
        const locked = await renderChip(createSessionAccessActionChip({
            label: 'Acme · Required by Team policy', accessibilityLabel: 'Session access: Acme · Required by Team policy',
            popoverContent: () => null, requiredByTeamPolicy: true,
        }));
        expect(locked.findByTestId('session-access-chip:policy-lock')).not.toBeNull();
        standardCleanup();

        const unlocked = await renderChip(createSessionAccessActionChip({
            label: 'Acme', accessibilityLabel: 'Session access: Acme', popoverContent: () => null,
        }));
        expect(unlocked.findByTestId('session-access-chip:policy-lock')).toBeNull();
    });
});

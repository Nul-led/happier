import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderScreen } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const capture = vi.hoisted(() => ({
    popoverProps: null as Record<string, unknown> | null,
    contentProps: null as Record<string, unknown> | null,
}));

vi.mock('@/components/ui/popover', () => ({
    Popover: (props: Record<string, unknown> & { children: (layout: { maxHeight: number; maxWidth: number }) => React.ReactNode }) => {
        capture.popoverProps = props;
        return React.createElement('Popover', props, props.children({ maxHeight: 600, maxWidth: 500 }));
    },
}));

vi.mock('@/components/ui/overlays/FloatingOverlay', () => ({
    FloatingOverlay: (props: Record<string, unknown>) => React.createElement('FloatingOverlay', props, props.children as React.ReactNode),
}));

vi.mock('./InboxContent', () => ({
    InboxContent: (props: Record<string, unknown>) => {
        capture.contentProps = props;
        return React.createElement('InboxContent', props);
    },
}));

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

describe('InboxPopover', () => {
    it('uses the canonical anchored overlay contract and closes before every navigation', async () => {
        const order: string[] = [];
        const onRequestClose = vi.fn(() => order.push('close'));
        const onOpenInbox = vi.fn(() => order.push('open'));
        const { InboxPopover } = await import('./InboxPopover');
        const model = {
            sessionPresentation: { markAllReadTargets: [] },
            markAllPending: false,
            markRead: vi.fn(),
        } as never;

        const screen = await renderScreen(
            <InboxPopover
                open
                anchorRect={{ left: 100, top: 40, width: 32, height: 32 }}
                focusReturnRef={{ current: null }}
                model={model}
                onRequestClose={onRequestClose}
                onOpenInbox={onOpenInbox}
            />,
        );

        expect(capture.popoverProps).toMatchObject({
            open: true,
            placement: 'bottom',
            autoFocusOnOpen: true,
            boundaryRef: null,
            maxWidthCap: 420,
            maxHeightCap: 560,
        });
        expect(capture.contentProps?.onBeforeNavigate).toBe(onRequestClose);
        expect(capture.contentProps?.presentation).toBe('popover');
        expect(screen.getTextContent()).not.toContain('tabs.inbox');
        expect(screen.findByTestId('inbox.popover.mark_all_read')).toBeNull();
        expect(screen.findByTestId('inbox.popover.open')).not.toBeNull();

        act(() => screen.pressByTestId('inbox.popover.open'));
        expect(order).toEqual(['close', 'open']);
    });

});

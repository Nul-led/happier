import * as React from 'react';

type PopoverModule = typeof import('@/components/ui/popover');
type InlinePopoverFrame = Readonly<{ maxHeight: number; maxWidth: number; placement: 'bottom' }>;
type InlinePopoverProps = Readonly<{
    open: boolean;
    children?: React.ReactNode | ((frame: InlinePopoverFrame) => React.ReactNode);
}>;

/**
 * The popover's portal and window-measurement boundary, rendered inline: an open popover renders its
 * content in place with a fixed measured frame, so a test drives the real menu (rows, selection,
 * closing) beneath it. Everything else in the module stays real.
 */
export async function createInlinePopoverModuleMock(
    importOriginal: <T>() => Promise<T>,
    frame: InlinePopoverFrame = { maxHeight: 320, maxWidth: 280, placement: 'bottom' },
): Promise<PopoverModule> {
    const original = await importOriginal<PopoverModule>();
    function InlinePopover(props: InlinePopoverProps) {
        if (!props.open) return null;
        return React.createElement(React.Fragment, null,
            typeof props.children === 'function' ? props.children(frame) : props.children);
    }
    return { ...original, Popover: InlinePopover as unknown as PopoverModule['Popover'] };
}

import * as React from 'react';

import type {
    VirtualizedListProps,
    VirtualizedListRef,
} from '@/components/ui/lists/virtualized/virtualizedListTypes';

type ViewportSize = Readonly<{ width: number; height: number }>;

/**
 * Keeps the focused virtual row visible when either focus or the viewport
 * changes. Keyboard and layout changes can shrink the recycler without
 * changing the focused option, so focus identity alone is not a sufficient
 * reveal trigger.
 */
export function useSelectionListVirtualizedFocusReveal(args: Readonly<{
    listRef: React.RefObject<VirtualizedListRef | null>;
    focusedItemIndex: number;
    reducedMotion: boolean;
}>): Readonly<{
    onViewportLayout: NonNullable<VirtualizedListProps<unknown>['onLayout']>;
}> {
    const revealFocusedItem = React.useCallback(() => {
        if (args.focusedItemIndex < 0) return;
        const ref = args.listRef.current;
        if (!ref || typeof ref.scrollToIndex !== 'function') return;
        ref.scrollToIndex({
            index: args.focusedItemIndex,
            viewPosition: 0.5,
            animated: !args.reducedMotion,
        });
    }, [args.focusedItemIndex, args.listRef, args.reducedMotion]);

    React.useEffect(() => {
        revealFocusedItem();
    }, [revealFocusedItem]);

    const previousViewportSizeRef = React.useRef<ViewportSize | null>(null);
    const onViewportLayout = React.useCallback<NonNullable<VirtualizedListProps<unknown>['onLayout']>>(
        (event) => {
            const { width, height } = event.nativeEvent.layout;
            const previous = previousViewportSizeRef.current;
            previousViewportSizeRef.current = { width, height };
            if (previous === null) return;
            if (previous.width === width && previous.height === height) return;
            revealFocusedItem();
        },
        [revealFocusedItem],
    );

    return { onViewportLayout };
}

import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Popover } from '@/components/ui/popover/Popover';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';

/** Keeps a tooltip off the window's edge when it is clamped there. */
const TOOLTIP_EDGE_PADDING_PX = 8;
/** `edgePadding` insets the boundary; the tooltip's own box carries no extra padding. */
const TOOLTIP_CONTAINER_STYLE = { paddingHorizontal: 0, paddingVertical: 0 } as const;
/** The side a tooltip asks for must hold about three lines, or it opens on the opposite side. */
const TOOLTIP_MAX_HEIGHT_PX = 72;

/**
 * Mounted only while its trigger is hovered or keyboard-focused. The Popover owner places it: sized
 * to its label, centred on the anchor's measured rect with one gap, flipped to the opposite side when
 * its own side has no room and clamped inside the window. The window, not the enclosing boundary, is
 * its limit, so a tooltip in the sidebar is never pushed off its button by the sidebar's edge.
 */
export default function AnchoredTooltip(props: Readonly<{
    anchorRef: React.RefObject<View | null>;
    label: string;
    content?: React.ReactNode;
    testID?: string;
    placement?: 'top' | 'bottom' | 'left' | 'right';
}>) {
    const { theme } = useUnistyles();
    return (
        <Popover
            open
            anchorRef={props.anchorRef}
            backdrop={false}
            boundaryRef={null}
            portal={{ web: true, matchAnchorWidth: false, anchorAlign: 'center', sizeToContent: true }}
            placement={props.placement ?? 'bottom'}
            flip
            gap={6}
            edgePadding={TOOLTIP_EDGE_PADDING_PX}
            containerStyle={TOOLTIP_CONTAINER_STYLE}
            minWidth={0}
            maxWidthCap={240}
            maxHeightCap={TOOLTIP_MAX_HEIGHT_PX}
        >
            {() => (
                <View role="tooltip" testID={props.testID} style={{ pointerEvents: 'none', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border.surface, backgroundColor: theme.colors.surface.elevated }}>
                    {props.content ?? <Text style={{ ...Typography.default(), fontSize: 12, lineHeight: 16, color: theme.colors.text.primary }}>{props.label}</Text>}
                </View>
            )}
        </Popover>
    );
}

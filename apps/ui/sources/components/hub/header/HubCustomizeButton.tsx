import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { IconButton } from '@/components/ui/buttons/IconButton';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { Popover } from '@/components/ui/popover';
import { SectionActionButton } from '@/components/ui/lists/SectionActionButton';
import { t } from '@/text';
import { useIsTablet } from '@/utils/platform/responsive';

import { HomeLayoutEditor } from '../layout/HomeLayoutEditor';

const CUSTOMIZE_POPOVER_WIDTH_PX = 360;
const CUSTOMIZE_POPOVER_MAX_HEIGHT_PX = 640;

/**
 * "Customize" in Home's header: the layout editor in a popover anchored to the button, over the live
 * page (every change shows behind it at once). A section's "⋯ → Customize" opens the same popover,
 * so the open state belongs to Home. The editor mounts only while open.
 */
export const HubCustomizeButton = React.memo(function HubCustomizeButton(props: Readonly<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
}>) {
    const anchorRef = React.useRef<View>(null);
    const { onOpenChange } = props;
    const toggle = React.useCallback(() => onOpenChange(!props.open), [onOpenChange, props.open]);
    const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
    // A phone's header has no room beside the greeting for a labelled button: the glyph alone (I1p).
    const compact = !useIsTablet();
    return (
        <View ref={anchorRef} collapsable={false} style={styles.anchor}>
            {compact ? (
                <IconButton
                    testID="home-hub.customize"
                    variant="plain"
                    iconName="sliders-horizontal"
                    accessibilityLabel={t('homeIndex.customizeTitle')}
                    onPress={toggle}
                />
            ) : (
                <SectionActionButton
                    testID="home-hub.customize"
                    title={t('homeIndex.customize')}
                    icon="sliders-horizontal"
                    onPress={toggle}
                />
            )}
            {props.open ? (
                <Popover
                    open
                    anchorRef={anchorRef}
                    autoFocusOnOpen
                    placement="bottom"
                    gap={8}
                    edgePadding={{ horizontal: 8, vertical: 8 }}
                    portal={{ web: true, native: true, matchAnchorWidth: false, anchorAlign: 'end' }}
                    maxWidthCap={CUSTOMIZE_POPOVER_WIDTH_PX}
                    maxHeightCap={CUSTOMIZE_POPOVER_MAX_HEIGHT_PX}
                    onRequestClose={close}
                >
                    {({ maxHeight, maxWidth }) => (
                        <View testID="home-hub.customize.popover">
                            <FloatingOverlay
                                maxHeight={Math.min(maxHeight, CUSTOMIZE_POPOVER_MAX_HEIGHT_PX)}
                                edgeFades={{ top: true, bottom: true, size: 18 }}
                                surfaceChrome="theme"
                                keyboardShouldPersistTaps="always"
                                containerStyle={{ width: Math.min(maxWidth, CUSTOMIZE_POPOVER_WIDTH_PX) }}
                            >
                                <HomeLayoutEditor presentation="popover" />
                            </FloatingOverlay>
                        </View>
                    )}
                </Popover>
            ) : null}
        </View>
    );
});

const styles = StyleSheet.create({
    anchor: {
        flexShrink: 0,
    },
});

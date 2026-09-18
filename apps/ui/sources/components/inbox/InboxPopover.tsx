import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { InboxModel } from '@/hooks/inbox/useInboxModel';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { Popover } from '@/components/ui/popover';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { InboxContent } from './InboxContent';

export type InboxPopoverAnchorRect = Readonly<{ left: number; top: number; width: number; height: number }>;

export const InboxPopover = React.memo(function InboxPopover(props: Readonly<{
    open: boolean;
    anchorRect: InboxPopoverAnchorRect | null;
    focusReturnRef?: React.RefObject<HTMLElement | null>;
    model: InboxModel;
    onRequestClose: () => void;
    onOpenInbox: () => void;
}>) {
    const { theme } = useUnistyles();
    const openInbox = React.useCallback(() => { props.onRequestClose(); props.onOpenInbox(); }, [props.onOpenInbox, props.onRequestClose]);
    if (!props.open || !props.anchorRect) return null;
    return (
        <Popover open autoFocusOnOpen anchor={{ kind: 'rect', rect: props.anchorRect, coordinateSpace: 'window' }} focusReturnRef={props.focusReturnRef} boundaryRef={null} placement="bottom" edgePadding={{ horizontal: 12, vertical: 12 }} portal={{ web: { target: 'body' }, native: true, matchAnchorWidth: false, anchorAlign: 'end' }} maxWidthCap={420} maxHeightCap={560} onRequestClose={props.onRequestClose}>
            {({ maxHeight, maxWidth }) => (
                <FloatingOverlay maxHeight={Math.min(maxHeight, 560)} edgeFades={{ top: true, bottom: true, size: 18 }} edgeIndicators initialVisibility={{ bottom: true }} surfaceChrome="theme" containerStyle={{ width: Math.min(maxWidth, 400) }} keyboardShouldPersistTaps="always">
                    <InboxContent model={props.model} onBeforeNavigate={props.onRequestClose} presentation="popover" />
                    <View style={styles.footer}>
                        <Pressable testID="inbox.popover.open" accessibilityRole="button" accessibilityLabel={t('inbox.openInbox')} onPress={openInbox} style={({ pressed }) => [styles.openAction, pressed ? styles.openActionPressed : null]}>
                            <Text style={styles.openLabel}>{t('inbox.openInbox')}</Text>
                            <Icon name="arrow-square-out" size={16} color={theme.colors.text.primary} />
                        </Pressable>
                    </View>
                </FloatingOverlay>
            )}
        </Popover>
    );
});

const styles = StyleSheet.create((theme) => ({
    footer: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border.surface,
    },
    openAction: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
    },
    openActionPressed: { opacity: 0.62 },
    openLabel: { fontSize: 14, lineHeight: 18, ...Typography.default('semiBold'), color: theme.colors.text.primary },
}));

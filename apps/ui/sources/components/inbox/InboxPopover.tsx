import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { InboxModelBoundary, useInboxModel } from '@/hooks/inbox/useInboxModel';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { Popover } from '@/components/ui/popover';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { InboxContent } from './InboxContent';
import { countInboxNeedsYou } from './inboxCounts';
import { motionTokens } from '@/components/ui/motion/motionTokens';

export type InboxPopoverAnchorRect = Readonly<{ left: number; top: number; width: number; height: number }>;

export const InboxPopover = React.memo(function InboxPopover(props: Readonly<{
    open: boolean;
    anchorRect: InboxPopoverAnchorRect | null;
    focusReturnRef?: React.RefObject<HTMLElement | null>;
    onRequestClose: () => void;
    onOpenInbox: () => void;
}>) {
    if (!props.open || !props.anchorRect) return null;
    return (
        <InboxModelBoundary>
            <OpenInboxPopover {...props} anchorRect={props.anchorRect} />
        </InboxModelBoundary>
    );
});

const OpenInboxPopover = React.memo(function OpenInboxPopover(props: Readonly<{
    anchorRect: InboxPopoverAnchorRect;
    focusReturnRef?: React.RefObject<HTMLElement | null>;
    onRequestClose: () => void;
    onOpenInbox: () => void;
}>) {
    const { theme } = useUnistyles();
    const model = useInboxModel();
    const openInbox = React.useCallback(() => { props.onRequestClose(); props.onOpenInbox(); }, [props.onOpenInbox, props.onRequestClose]);
    const needsYouCount = countInboxNeedsYou(model);
    return (
        <Popover open autoFocusOnOpen anchor={{ kind: 'rect', rect: props.anchorRect, coordinateSpace: 'window' }} focusReturnRef={props.focusReturnRef} boundaryRef={null} placement="bottom" edgePadding={{ horizontal: 12, vertical: 12 }} portal={{ web: { target: 'body' }, native: true, matchAnchorWidth: false, anchorAlign: 'end' }} maxWidthCap={420} maxHeightCap={560} onRequestClose={props.onRequestClose}>
            {({ maxHeight, maxWidth }) => (
                <FloatingOverlay maxHeight={Math.min(maxHeight, 560)} edgeFades={{ top: true, bottom: true, size: 18 }} edgeIndicators initialVisibility={{ bottom: true }} surfaceChrome="theme" containerStyle={{ width: Math.min(maxWidth, 400) }} keyboardShouldPersistTaps="always">
                    {/* Lab `inbox-I2`: the popover names itself and its count, with "Open Inbox" as the header's one quiet action. */}
                    <View style={styles.header}>
                        <Text accessibilityRole="header" style={styles.title}>{t('tabs.inbox')}</Text>
                        {needsYouCount > 0 ? <Text style={styles.count}>{String(needsYouCount)}</Text> : null}
                        <View style={styles.grow} />
                        <Pressable testID="inbox.popover.open" accessibilityRole="button" accessibilityLabel={t('inbox.openInbox')} onPress={openInbox} hitSlop={8} style={({ pressed }) => [styles.openAction, pressed ? styles.openActionPressed : null]}>
                            <Text style={styles.openLabel}>{t('inbox.openInbox')}</Text>
                            <Icon name="caret-right" size={14} color={theme.colors.text.tertiary} />
                        </Pressable>
                    </View>
                    <InboxContent model={model} onBeforeNavigate={props.onRequestClose} onOpenInbox={openInbox} presentation="popover" />
                </FloatingOverlay>
            )}
        </Popover>
    );
});

const styles = StyleSheet.create((theme) => ({
    header: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingLeft: 16,
        paddingRight: 12,
        paddingTop: 6,
    },
    title: { fontSize: 14, lineHeight: 18, ...Typography.default('semiBold'), color: theme.colors.text.primary },
    count: { fontSize: 13, lineHeight: 18, ...Typography.default('regular'), color: theme.colors.text.tertiary, fontVariant: ['tabular-nums'] },
    grow: { flex: 1 },
    openAction: {
        minHeight: 32,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    openActionPressed: { opacity: motionTokens.press.opacity },
    openLabel: { fontSize: 13, lineHeight: 18, ...Typography.default('regular'), color: theme.colors.text.secondary },
}));

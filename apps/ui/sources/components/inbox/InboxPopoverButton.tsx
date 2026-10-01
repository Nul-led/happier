import { useRouter } from 'expo-router';
import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { InboxSummary } from '@/hooks/inbox/useInboxSummary';
import { t } from '@/text';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';

import { Icon } from '@/components/ui/icons/Icon';
import { usePressFeedback } from '@/components/ui/interactions/usePressFeedback';
import { InboxPopover, type InboxPopoverAnchorRect } from './InboxPopover';

export const InboxPopoverButton = React.memo(function InboxPopoverButton(props: Readonly<{
    summary: InboxSummary;
    buttonSize: number;
    iconSize: number;
    testID?: string;
}>) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [open, setOpen] = React.useState(false);
    const [anchorRect, setAnchorRect] = React.useState<InboxPopoverAnchorRect | null>(null);
    const focusReturnRef = React.useRef<HTMLElement | null>(null);
    const close = React.useCallback(() => setOpen(false), []);
    // Icon-sized mark: the glyph mode pairs the scale with the opacity dip.
    const feedback = usePressFeedback({ glyph: true });
    const openFullInbox = React.useCallback(() => {
        const result = runGuardedNavigation(() => router.push('/(app)/inbox'));
        if (result !== true) {
            fireAndForget(result, { tag: 'CollapsedSidebarView.nav.inbox' });
        }
    }, [router]);
    const toggle = React.useCallback((event?: unknown) => {
        if (open) {
            setOpen(false);
            return;
        }
        if (Platform.OS !== 'web') {
            openFullInbox();
            return;
        }
        const target = (event as { currentTarget?: unknown } | undefined)?.currentTarget as {
            getBoundingClientRect?: () => InboxPopoverAnchorRect;
        } | undefined;
        const rect = target?.getBoundingClientRect?.();
        if (!rect) return;
        focusReturnRef.current = target as HTMLElement;
        setAnchorRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
        setOpen(true);
    }, [open, openFullInbox]);

    return (
        <>
            <Pressable
                testID={props.testID ?? 'sidebar-inbox-button'}
                accessibilityRole="button"
                accessibilityLabel={t('tabs.inbox')}
                accessibilityState={{ expanded: open }}
                hitSlop={8}
                onPress={toggle}
                onPressIn={feedback.onPressIn}
                onPressOut={feedback.onPressOut}
                style={[
                    styles.button,
                    {
                        width: props.buttonSize,
                        height: props.buttonSize,
                        borderRadius: props.buttonSize / 2,
                    },
                ]}
            >
                <Animated.View style={[styles.glyph, feedback.animatedStyle]}>
                    <Icon
                        name="mailbox"
                        size={props.iconSize}
                        color={theme.colors.chrome.header.foreground}
                    />
                    {props.summary.hasContent ? (
                        <View testID="sidebar-inbox-attention-dot" style={styles.attentionDot} />
                    ) : null}
                </Animated.View>
            </Pressable>
            <InboxPopover
                open={open}
                anchorRect={anchorRect}
                focusReturnRef={focusReturnRef}
                onRequestClose={close}
                onOpenInbox={openFullInbox}
            />
        </>
    );
});

const styles = StyleSheet.create((theme) => ({
    button: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    glyph: {
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
    },
    attentionDot: {
        position: 'absolute',
        right: -3,
        top: -2,
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: theme.colors.chrome.header.foreground,
        borderWidth: 1.5,
        borderColor: theme.colors.background.canvas,
    },
}));

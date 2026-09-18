import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { resolveOverlayPointerEvents } from '@/components/ui/overlays/resolveOverlayPointerEvents';
import { useOptionalSafeAreaInsets } from '@/hooks/ui/useOptionalSafeAreaInsets';

import {
    readPresentationNotice,
    retirePresentationNotice,
    subscribePresentationNotices,
} from './presentationNotices';

/**
 * The app's ONE transient presentation notice, drawn.
 *
 * Every producer — the daemon presentation stream, mounted plugin `notify`, and
 * Board/Companion feedback — publishes to `presentationNotices`; this is the only
 * place that reads it. It lives beside its runtime rather than inside it so the
 * chrome that matters to a person (does it clear the notch, can a thumb hit
 * Undo) can be exercised on its own, without standing up a daemon binding.
 *
 * It performs no domain mutation: `undo` is a caller-owned local inverse that the
 * publisher bound to its own exact target.
 */

/** Distance from the top of the usable window; the notch is added on top of it. */
const NOTICE_TOP_MARGIN_PX = 12;

const stylesheet = StyleSheet.create((theme) => ({
    noticeHost: {
        position: 'absolute',
        left: 16,
        right: 16,
        alignItems: 'center',
        zIndex: 200,
    },
    notice: {
        maxWidth: 560,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.elevated,
        paddingHorizontal: 14,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    noticeText: {
        color: theme.colors.text.primary,
        fontSize: 14,
        flexShrink: 1,
    },
    undoControl: {
        // The one interactive element in an otherwise passive notice, so it keeps
        // the platform's own accessible target rather than a copied constant.
        minHeight: resolveMinimumInteractiveTargetSize(Platform.OS),
        justifyContent: 'center',
        paddingHorizontal: 8,
        borderRadius: 8,
    },
    undoControlActive: {
        backgroundColor: theme.colors.surface.pressed,
    },
    undoLabel: {
        color: theme.colors.text.link,
        fontSize: 14,
        fontWeight: '600',
    },
}));

export const PresentationNoticeHost = React.memo(function PresentationNoticeHost() {
    const styles = stylesheet;
    const notice = React.useSyncExternalStore(
        subscribePresentationNotices,
        readPresentationNotice,
        readPresentationNotice,
    );
    // The notice floats over whatever the app is showing, so it consumes the
    // window's own safe region. Without it the card sits under the notch, the
    // status bar or a rounded corner on the exact devices that have one.
    const safeAreaInsets = useOptionalSafeAreaInsets();

    // Holding the existing lifetime open while the Undo control is focused or
    // hovered keeps it from disappearing mid-use. This is the same one host
    // lifecycle, not a second scheduler.
    const [undoControlEngaged, setUndoControlEngaged] = React.useState(false);
    const undo = notice?.undo ?? null;
    React.useEffect(() => {
        if (!undo) setUndoControlEngaged(false);
    }, [undo]);

    React.useEffect(() => {
        if (!notice || undoControlEngaged) return;
        const timeout = setTimeout(() => retirePresentationNotice(notice.key), 4_000);
        return () => clearTimeout(timeout);
    }, [notice, undoControlEngaged]);

    const onUndoPress = React.useCallback(() => {
        if (!notice?.undo) return;
        notice.undo.run();
        retirePresentationNotice(notice.key);
    }, [notice]);

    // The empty space beside the card must keep passing touches through to the
    // app underneath, while the card's own Undo stays hit-testable. React Native
    // removes a `pointerEvents="none"` view AND its whole subtree from hit
    // testing, so only `box-none` expresses that; the platform seam itself lives
    // in the overlay owner every other host here already consumes.
    const hostPointerEvents = resolveOverlayPointerEvents('box-none');
    const noticePointerEvents = resolveOverlayPointerEvents(undo ? 'auto' : 'none');

    if (!notice) return null;
    return (
        <View
            style={[
                styles.noticeHost,
                { top: NOTICE_TOP_MARGIN_PX + safeAreaInsets.top },
                hostPointerEvents.webStyle,
            ]}
            pointerEvents={hostPointerEvents.nativePointerEvents}
            testID="current-session-presentation-notice"
        >
            <View
                style={[styles.notice, noticePointerEvents.webStyle]}
                pointerEvents={noticePointerEvents.nativePointerEvents}
                accessibilityRole={notice.severity === 'error' ? 'alert' : 'text'}
                accessibilityLiveRegion={notice.severity === 'error' ? 'assertive' : 'polite'}
            >
                <Text style={styles.noticeText}>{notice.message}</Text>
                {undo ? (
                    <Pressable
                        testID="current-session-presentation-notice-undo"
                        accessibilityRole="button"
                        accessibilityLabel={undo.label}
                        hitSlop={8}
                        onPress={onUndoPress}
                        onFocus={() => setUndoControlEngaged(true)}
                        onBlur={() => setUndoControlEngaged(false)}
                        onHoverIn={() => setUndoControlEngaged(true)}
                        onHoverOut={() => setUndoControlEngaged(false)}
                        style={({ pressed }) => [styles.undoControl, pressed && styles.undoControlActive]}
                    >
                        <Text style={styles.undoLabel}>{undo.label}</Text>
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
});

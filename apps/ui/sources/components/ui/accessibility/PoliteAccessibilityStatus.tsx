import * as React from 'react';
import { Platform, View } from 'react-native';

import { resolveOverlayPointerEvents } from '@/components/ui/overlays/resolveOverlayPointerEvents';
import { Text } from '@/components/ui/text/Text';
import { announceAccessibilityMessage } from './announceAccessibilityMessage';
import { visuallyHiddenStyle } from './visuallyHiddenStyle';

type AnnouncementSnapshot = Readonly<{ transitionKey: string; text: string; fromMount: boolean }>;

/**
 * The one declarative polite announcer. Every platform speaks exactly on
 * `transitionKey` transitions, with the same rules:
 *
 * - The state a surface mounts with is already on screen, so it is never
 *   announced: iOS makes no announcement call, and web/Android render it inside
 *   the region as it is inserted, which live regions do not treat as a change
 *   (it stays discoverable by swipe/virtual cursor).
 * - A new key speaks its announcement, even when the text repeats the previous
 *   message (web/Android get a freshly keyed text node, iOS a new announce call).
 * - New text under the same key coalesces into the snapshot taken when the key
 *   arrived; consumers that must re-speak changed text change the key.
 * - An empty announcement is silent but still counts as a transition.
 *
 * Web/Android keep one live region mounted (live regions only announce text
 * inserted after they exist); iOS has no live regions and uses the imperative
 * primitive instead.
 */
export const PoliteAccessibilityStatus = React.memo(function PoliteAccessibilityStatus(props: Readonly<{
    announcement: string;
    statusTestID: string;
    transitionKey: string;
}>) {
    const [snapshot, setSnapshot] = React.useState<AnnouncementSnapshot>(() => ({
        transitionKey: props.transitionKey,
        text: props.announcement,
        fromMount: true,
    }));
    let current = snapshot;
    if (snapshot.transitionKey !== props.transitionKey) {
        current = { transitionKey: props.transitionKey, text: props.announcement, fromMount: false };
        setSnapshot(current);
    }

    React.useEffect(() => {
        if (Platform.OS !== 'ios' || current.fromMount) return;
        announceAccessibilityMessage(current.text);
    }, [current]);

    if (Platform.OS === 'ios') return null;
    const pointerEvents = resolveOverlayPointerEvents('none');
    return (
        <View
            testID={props.statusTestID}
            accessible
            accessibilityLiveRegion="polite"
            pointerEvents={pointerEvents.nativePointerEvents}
            style={[visuallyHiddenStyle, pointerEvents.webStyle]}
            {...({ role: 'status', 'aria-live': 'polite', 'aria-atomic': true } as Record<string, unknown>)}
        >
            <Text key={current.transitionKey}>{current.text}</Text>
        </View>
    );
});

import * as React from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Avatar } from '@/components/ui/avatar/Avatar';
import { Text } from '@/components/ui/text/Text';
import { DeferredAnchoredTooltip } from '@/components/ui/overlays/DeferredAnchoredTooltip';
import { ITEM_SUBTITLE_TEXT_METRICS } from '@/components/ui/lists/itemDensityMetrics';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { motionTokens } from '@/components/ui/motion/motionTokens';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { formatAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
import type { SessionHumanPresenceViewer } from '@/sync/domains/session/humanPresence/sessionHumanPresenceStore';

const AVATAR_SIZE = 28;
/** One de-emphasis for retained last-known presence, shared with the Collaboration summary row. */
export const STALE_PRESENCE_OPACITY = 0.65;
const styles = StyleSheet.create((theme) => ({
    button: {
        minHeight: resolveMinimumInteractiveTargetSize(Platform.OS),
        minWidth: resolveMinimumInteractiveTargetSize(Platform.OS),
        paddingHorizontal: 8,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        borderRadius: 8, borderWidth: 1, borderColor: 'transparent',
    },
    hovered: { backgroundColor: theme.colors.surface.selected },
    focused: { borderColor: theme.colors.border.focus },
    avatar: { borderRadius: AVATAR_SIZE, borderWidth: 2, borderColor: theme.colors.border.default },
    typing: { borderColor: theme.colors.text.link },
    overflow: { ...Typography.default('semiBold'), ...ITEM_SUBTITLE_TEXT_METRICS.cozy, color: theme.colors.text.secondary, paddingLeft: 4 },
}));

function ViewerAvatar({ viewer, stale, index }: Readonly<{ viewer: SessionHumanPresenceViewer; stale: boolean; index: number }>) {
    const reducedMotion = useReducedMotionPreference();
    const opacity = React.useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
    React.useEffect(() => {
        if (reducedMotion) { opacity.setValue(1); return; }
        const animation = Animated.timing(opacity, { toValue: 1, duration: motionTokens.durationMs.fast, useNativeDriver: true });
        animation.start();
        return () => animation.stop();
    }, [opacity, reducedMotion]);
    return <Animated.View testID="session-viewer-avatar" accessible={false} style={[
        styles.avatar, !stale && viewer.typing && styles.typing, { marginLeft: index === 0 ? 0 : -8, opacity },
    ]}>
        <Avatar id={viewer.account.accountId} size={AVATAR_SIZE} imageUrl={viewer.account.avatarUrl} />
    </Animated.View>;
}

export function SessionViewerFacepile({ viewers, stale, attentionLabel, onPress }: Readonly<{
    viewers: readonly SessionHumanPresenceViewer[];
    stale: boolean;
    attentionLabel?: string | null;
    onPress: () => void;
}>): React.ReactElement | null {
    const anchorRef = React.useRef<View | null>(null);
    const [hovered, setHovered] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    if (viewers.length === 0) return null;
    const names = viewers.map((viewer) => formatAccountDisplayName(viewer.account) ?? t('session.collaboration.unnamed')).join(', ');
    const label = `${t('session.collaboration.title')}, ${t('session.collaboration.viewingNow')}, ${viewers.length}: ${names}${stale ? `. ${t('session.collaboration.stale')}` : ''}${attentionLabel ? `. ${attentionLabel}` : ''}`;
    return <Pressable
        ref={anchorRef}
        testID="session-viewer-facepile"
        onPress={onPress}
        onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t('session.collaboration.open')}
        style={({ pressed }) => [styles.button, hovered && styles.hovered, focused && styles.focused, { opacity: pressed ? 0.7 : stale ? STALE_PRESENCE_OPACITY : 1 }]}
    >
        <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center' }}>
            {viewers.slice(0, 3).map((viewer, index) => <ViewerAvatar key={viewer.account.accountId} viewer={viewer} stale={stale} index={index} />)}
            {viewers.length > 3 ? <Text testID="session-viewer-overflow" style={styles.overflow}>{`+${viewers.length - 3}`}</Text> : null}
        </View>
        {Platform.OS === 'web' && (hovered || focused) ? <DeferredAnchoredTooltip anchorRef={anchorRef} activationKey={`${hovered}:${focused}`} label={t('session.collaboration.open')} /> : null}
    </Pressable>;
}

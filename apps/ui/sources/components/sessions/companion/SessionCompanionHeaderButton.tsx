import * as React from 'react';
import { Platform, Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { SessionHeaderIconWithCount } from '@/components/sessions/actions/SessionHeaderIconWithCount';
import {
    SESSION_HEADER_ACTION_TAP_TARGET_PX,
    SESSION_HEADER_ICON_SIZE_PX,
} from '@/components/sessions/actions/sessionHeaderIconMetrics';
import { Icon } from '@/components/ui/icons/Icon';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';

import {
    resolveSessionCompanionHeaderAccessibilityLabel,
    type SessionCompanionHeaderIntent,
} from './sessionCompanionHeaderIntent';

/**
 * Visual projection of the canonical Companion header action. The Session
 * header menu owns placement and execution so direct and overflow never become
 * separate commands or compete for independent width budgets.
 */
export const SessionCompanionHeaderButton = React.memo((props: Readonly<{
    intent: SessionCompanionHeaderIntent;
    onPress: () => void;
}>) => {
    const { theme } = useUnistyles();
    const { intent } = props;
    const targetSize = resolveMinimumInteractiveTargetSize(Platform.OS);
    const hitSlop = targetSize > SESSION_HEADER_ACTION_TAP_TARGET_PX ? undefined : 15;

    return (
        <Pressable
            onPress={props.onPress}
            hitSlop={hitSlop}
            accessibilityRole="button"
            accessibilityState={{ expanded: intent.expanded }}
            accessibilityLabel={resolveSessionCompanionHeaderAccessibilityLabel(intent)}
            testID="session-header-companion"
            style={({ pressed }) => ({
                width: targetSize,
                height: targetSize,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
            })}
        >
            <SessionHeaderIconWithCount count={intent.itemCount}>
                <Icon name="stack-simple" size={SESSION_HEADER_ICON_SIZE_PX} color={theme.colors.chrome.header.foreground} />
            </SessionHeaderIconWithCount>
        </Pressable>
    );
});

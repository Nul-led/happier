import * as React from 'react';
import { StyleSheet } from 'react-native-unistyles';

import { WelcomeActionCard } from '@/components/onboarding/preAuth/WelcomeActionCard';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import type { ExactHomeDestinationState } from './useExactHomeDestination';

/**
 * Reaching the exact Home a committed operation belongs to.
 *
 * Every surface that lands a one-time bearer — mail verification, password
 * reset, an invitation, the Welcome connect flow — needs this same pair of
 * states, so it lives with `useExactHomeDestination` instead of being respelled
 * per host. The retry re-runs focus alone: the bearer has already been consumed,
 * and leaving the submitting affordance mounted would invite a second
 * submission of it.
 */
export function ExactHomeDestinationNotice(props: Readonly<{
    testID: string;
    state: Exclude<ExactHomeDestinationState, { kind: 'idle' }>;
}>): React.ReactElement {
    if (props.state.kind === 'focusing') {
        return (
            <Text testID={`${props.testID}-working`} style={styles.body}>
                {t('settingsAccount.nativePassword.working')}
            </Text>
        );
    }
    const { retry } = props.state;
    return <>
        <Text
            testID={`${props.testID}-error`}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={styles.error}
        >
            {t('settingsAccount.nativePassword.serverUnavailable')}
        </Text>
        <WelcomeActionCard
            testID={`${props.testID}-retry`}
            title={t('common.retry')}
            iconName="arrow-clockwise"
            primary
            onPress={retry}
        />
    </>;
}

const styles = StyleSheet.create((theme) => ({
    body: { fontSize: 14, color: theme.colors.text.secondary },
    error: { fontSize: 14, color: theme.colors.status.error },
}));

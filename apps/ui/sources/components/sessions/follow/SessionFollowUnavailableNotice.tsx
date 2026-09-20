import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Text } from '@/components/ui/text/Text';
import { useLayoutMaxWidthStyle } from '@/components/ui/layout/layout';
import { t } from '@/text';

const styles = StyleSheet.create((theme) => ({
    root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    title: { textAlign: 'center', marginBottom: 8 },
    description: { textAlign: 'center', color: theme.colors.text.secondary },
    back: { marginTop: 16 },
}));

/**
 * Settled "Following is not available on this Home" state for the direct Follow route.
 *
 * The route is reachable from a link, a notification and a deep link, so a Home that does not
 * offer Following must say so instead of rendering an empty screen. The back target is the exact
 * Session address the link named, never an ambient Home.
 */
export function SessionFollowUnavailableNotice(props: Readonly<{ onBack: () => void }>): React.ReactElement {
    const maxWidthStyle = useLayoutMaxWidthStyle();
    return (
        <View testID="session-follow-unavailable" style={[styles.root, maxWidthStyle]}>
            <Text style={styles.title}>{t('session.follow.unavailableTitle')}</Text>
            <Text style={styles.description}>{t('session.follow.unavailableDescription')}</Text>
            <RoundButton
                title={t('common.back')}
                display="inverted"
                size="normal"
                onPress={props.onBack}
                testID="session-follow-unavailable.back"
                style={styles.back}
            />
        </View>
    );
}

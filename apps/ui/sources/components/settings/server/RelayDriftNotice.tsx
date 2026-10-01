import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AttentionBanner } from '@/components/ui/lists/AttentionBanner';
import { ListPresentationProvider } from '@/components/ui/lists/listPresentation';
import { isDesktopHost } from '@/utils/platform/desktopHost';

import { RelayDriftActionCard } from './RelayDriftActionCard';
import type { RelayDriftBanner } from './relayDriftTypes';

/**
 * This computer's daemon serves another Home or account than the app: the one presentation of that
 * state, above the content it concerns. The desktop app can repair it (action card); elsewhere the page
 * can only say so (a tinted banner).
 */
export const RelayDriftNotice = React.memo(function RelayDriftNotice(props: Readonly<{
    banner: RelayDriftBanner;
    /** Test id of the read-only banner (non-desktop). */
    testID: string;
}>) {
    if (isDesktopHost()) {
        return (
            <View style={styles.card}>
                <RelayDriftActionCard banner={props.banner} />
            </View>
        );
    }
    return (
        <ListPresentationProvider value="page">
            <AttentionBanner
                testID={props.testID}
                title={props.banner.title}
                description={props.banner.description}
            />
        </ListPresentationProvider>
    );
});

const styles = StyleSheet.create(() => ({
    card: {
        paddingHorizontal: 16,
        paddingTop: 12,
    },
}));

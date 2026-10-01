import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { ConnectionStatusControl } from '@/components/navigation/ConnectionStatusControl';
import { ItemList } from '@/components/ui/lists/ItemList';
import { PAGE_LIST_METRICS } from '@/components/ui/lists/pageListMetrics';

/**
 * Account & Homes on a phone: the same identity, Homes and fixes as the desktop account/Home popover
 * (`ConnectionStatusControl`), as a page the header's Home line opens. Presentation only; every
 * action is the popover's.
 */
export function AccountAndHomesScreen() {
    return (
        // The grouped (canvas) background, so the popover's surface reads as a card on it (lab `xacct-P1`).
        <ItemList testID="account-homes-page">
            <View style={styles.column}>
                <ConnectionStatusControl variant="page" />
            </View>
        </ItemList>
    );
}

const styles = StyleSheet.create(() => ({
    column: {
        paddingHorizontal: PAGE_LIST_METRICS.sheetInsetPx,
        paddingTop: PAGE_LIST_METRICS.pageHeaderUnderChromePaddingTopPx,
    },
}));

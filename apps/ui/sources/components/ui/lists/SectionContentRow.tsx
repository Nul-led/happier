import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { PAGE_LIST_METRICS } from './pageListMetrics';

/**
 * Free-form content that sits directly in a page section (a visual picker the section title already
 * names), with the same insets and row divider as an `Item`. `ItemGroup` injects `showDivider`.
 * `continuesRow` places it directly under the row above (which then draws no divider), for content
 * that belongs to that row, such as a preview of its choice.
 */
export function SectionContentRow(props: Readonly<{
    children: React.ReactNode;
    showDivider?: boolean;
    continuesRow?: boolean;
    testID?: string;
}>) {
    return (
        <View
            testID={props.testID}
            style={[styles.row, props.continuesRow ? styles.continuesRow : null, props.showDivider !== false ? styles.divider : null]}
        >
            {props.children}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    row: {
        paddingHorizontal: PAGE_LIST_METRICS.rowPaddingHorizontalPx,
        paddingTop: PAGE_LIST_METRICS.rowPaddingVerticalPx + 2,
        paddingBottom: PAGE_LIST_METRICS.rowPaddingVerticalPx,
    },
    continuesRow: {
        paddingTop: 0,
    },
    divider: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border.subtle,
    },
}));

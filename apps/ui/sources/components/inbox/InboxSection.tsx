import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { SelectionListSectionHeader } from '@/components/ui/selectionList/SelectionListSectionHeader';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';

/** One section owner with host-selected grouped screen or flat popover chrome. */
export const InboxSection = React.memo(function InboxSection(props: Readonly<{
    testID: string;
    title: string;
    rightAccessory?: React.ReactNode;
    spacingBefore?: 'following' | 'separated';
    surface?: 'flat' | 'grouped';
    children: React.ReactNode;
}>) {
    const grouped = props.surface === 'grouped';
    const header = (
        <SelectionListSectionHeader
            testID={`${props.testID}.header`}
            title={props.title}
            rightAccessory={props.rightAccessory}
            containerStyle={grouped
                ? styles.groupedHeader
                : props.rightAccessory
                    ? styles.actionHeader
                    : undefined}
        />
    );

    return (
        <View
            testID={props.testID}
            style={props.spacingBefore === 'following'
                ? styles.following
                : props.spacingBefore === 'separated'
                    ? styles.separated
                    : undefined}
        >
            {grouped ? (
                <ItemGroup title={header} headerStyle={styles.groupedItemGroupHeader} clipContent>
                    {props.children}
                </ItemGroup>
            ) : (
                <>
                    {header}
                    {props.children}
                </>
            )}
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    following: {
        marginTop: 6,
    },
    separated: {
        marginTop: 14,
    },
    groupedHeader: {
        minHeight: Platform.select({ ios: 44, default: 48 }),
        paddingHorizontal: Platform.select({ ios: 32, default: 24 }),
        paddingTop: 0,
        paddingBottom: 0,
    },
    actionHeader: {
        minHeight: Platform.select({ ios: 44, default: 48 }),
    },
    groupedItemGroupHeader: {
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
    },
}));

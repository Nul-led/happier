import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';

/**
 * A sheetless row of buttons at the end of a page section: a form's Save and Cancel, or the quiet
 * leave-and-destroy actions that close a page. Place it inside `ItemGroup surface="none"`, or after
 * a section's sheet. Buttons wrap on narrow widths; `trailing` buttons are pushed to the far edge
 * (the irreversible one), and `footnote` states a consequence or an inline error beneath.
 */
export function SectionButtonRow(props: Readonly<{
    children: React.ReactNode;
    trailing?: React.ReactNode;
    /** One line under the buttons: the consequence of the destructive action, or a form's error. */
    footnote?: string | null;
    footnoteTone?: 'secondary' | 'danger';
    footnoteTestID?: string;
    testID?: string;
}>) {
    const styles = stylesheet;
    return (
        <View testID={props.testID} style={styles.container}>
            <View style={styles.row}>
                {props.children}
                {props.trailing ? <View style={styles.spacer} /> : null}
                {props.trailing}
            </View>
            {props.footnote ? (
                <Text
                    testID={props.footnoteTestID}
                    style={[styles.footnote, props.footnoteTone === 'danger' ? styles.footnoteDanger : null]}
                    // A refusal is announced as soon as it appears; a consequence note is static.
                    accessibilityRole={props.footnoteTone === 'danger' ? 'alert' : undefined}
                    accessibilityLiveRegion={props.footnoteTone === 'danger' ? 'assertive' : undefined}
                >
                    {props.footnote}
                </Text>
            ) : null}
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        gap: 8,
    },
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
    },
    spacer: {
        flexGrow: 1,
    },
    footnote: {
        ...Typography.default('regular'),
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.text.secondary,
    },
    footnoteDanger: {
        color: theme.colors.state.danger.foreground,
    },
}));

import * as React from 'react';
import { StyleSheet } from 'react-native-unistyles';

import { PageHeaderMarkTile } from '@/components/ui/layout/PageHeaderEntityParts';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';

/**
 * The identity mark of an entity that has no logo of its own (a plugin, a Home): the first letter
 * of its name in the entity mark tile. `size="page"` is the mark at the head of the entity's page.
 */
export const MonogramMark = React.memo(function MonogramMark(props: Readonly<{
    title: string;
    size?: 'row' | 'page';
    testID?: string;
}>) {
    const styles = stylesheet;
    const page = props.size === 'page';
    const letter = Array.from(props.title.trim())[0]?.toLocaleUpperCase() ?? '';
    return (
        <PageHeaderMarkTile testID={props.testID} size={page ? 'page' : 'row'}>
            <Text
                style={[styles.letter, page ? styles.letterPage : styles.letterRow]}
                accessibilityElementsHidden
                importantForAccessibility="no"
            >
                {letter}
            </Text>
        </PageHeaderMarkTile>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    letter: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.secondary,
    },
    letterRow: {
        fontSize: 15,
        lineHeight: 20,
    },
    letterPage: {
        fontSize: 19,
        lineHeight: 24,
    },
}));

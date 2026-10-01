import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

/** The overlapping identity marks used in collaboration rows and headers. */
export type AvatarStackEntry = Readonly<{
    key: string;
    content: React.ReactNode;
    /** Only a real avatar has the separating ring; team and link glyphs stay bare. */
    avatar?: boolean;
    ringColor?: string;
    testID?: string;
}>;

export function AvatarStack(props: Readonly<{
    entries: readonly AvatarStackEntry[];
    size: number;
    testID?: string;
    ringColor?: string;
    accessibilityLabel?: string;
    /** A known row projection can reserve its maximum stack width while loading or changing authors. */
    reservedCount?: number;
}>) {
    const { theme } = useUnistyles();
    return <View
        testID={props.testID}
        accessible={Boolean(props.accessibilityLabel)}
        accessibilityRole={props.accessibilityLabel ? 'image' : undefined}
        accessibilityLabel={props.accessibilityLabel}
        importantForAccessibility={props.accessibilityLabel ? undefined : 'no-hide-descendants'}
        style={[styles.stack, props.reservedCount === undefined ? undefined : {
            width: (props.size + 4) + Math.max(0, props.reservedCount - 1) * (props.size - 2),
        }]}
    >
        {props.entries.map((entry, index) => <View
            key={entry.key}
            testID={entry.testID}
            accessible={false}
            style={[
                styles.mark,
                { width: props.size + 4, height: props.size + 4, marginLeft: index === 0 ? 0 : -6 },
                entry.avatar === false ? null : {
                    borderRadius: props.size / 2 + 2,
                    borderWidth: 2,
                    borderColor: entry.ringColor ?? props.ringColor ?? theme.colors.surface.base,
                },
            ]}
        >{entry.content}</View>)}
    </View>;
}

const styles = StyleSheet.create(() => ({
    stack: { flexDirection: 'row', alignItems: 'center' },
    mark: { alignItems: 'center', justifyContent: 'center' },
}));

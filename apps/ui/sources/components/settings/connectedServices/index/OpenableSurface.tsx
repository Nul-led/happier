import * as React from 'react';
import { Pressable, StyleSheet as RNStyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * A row or card whose body opens its entity while it also holds its own buttons (★, ↻, Sign in again,
 * Use one). The open action is a backdrop under the content, not a parent of it, so no button nests in
 * another (invalid on the web) and each control keeps its own press, focus and name. Content that is
 * only read sits in `pointerEvents="none"` blocks so a press on it reaches the backdrop.
 */
export const OpenableSurface = React.memo(function OpenableSurface(props: Readonly<{
    testID: string;
    accessibilityLabel: string;
    onPress: () => void;
    style: StyleProp<ViewStyle>;
    hoveredStyle?: StyleProp<ViewStyle>;
    children: React.ReactNode;
}>) {
    const [hovered, setHovered] = React.useState(false);
    return (
        <View style={[props.style, hovered ? props.hoveredStyle : null]}>
            <Pressable
                testID={props.testID}
                accessibilityRole="button"
                accessibilityLabel={props.accessibilityLabel}
                onPress={props.onPress}
                onHoverIn={() => setHovered(true)}
                onHoverOut={() => setHovered(false)}
                style={RNStyleSheet.absoluteFill}
            />
            {props.children}
        </View>
    );
});

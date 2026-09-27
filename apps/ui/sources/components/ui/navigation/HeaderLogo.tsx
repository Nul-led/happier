import * as React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { useUnistyles } from 'react-native-unistyles';

/**
 * The Happier mark. Shared by the main-tab headers (extracted to prevent flickering on tab
 * switches - when each tab had its own HeaderLeft, the component would unmount/remount) and by
 * rows that name the Happier Cloud service. `size` is the mark's size; its box adds a small inset.
 */
export const HeaderLogo = React.memo((props: Readonly<{ size?: number }>) => {
    const size = props.size ?? 24;
    const { rt } = useUnistyles();
    const source = rt.themeName === 'dark'
        ? require('@/assets/images/logo-white.png')
        : require('@/assets/images/logo-black.png');
    return (
        <View style={{
            width: size + 8,
            height: size + 8,
            alignItems: 'center',
            justifyContent: 'center',
        }}>
            <Image
                source={source}
                contentFit="contain"
                style={{ width: size, height: size }}
            />
        </View>
    );
});

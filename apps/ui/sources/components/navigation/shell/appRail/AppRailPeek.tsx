import * as React from 'react';
import { View } from 'react-native';

import { useAppShellPeek } from './AppShellPeek';

/**
 * A rail icon whose destination has a column: resting on it peeks that column in the column's place
 * (`AppShellPeek`), and the right arrow on the focused icon opens the peek with focus inside. The icon
 * keeps its own press (it navigates) and focus. `children(peeks)` lets the icon drop its tooltip while
 * resting on it shows the column instead.
 */
export function AppRailPeek(props: Readonly<{
    testID: string;
    /** The destination whose column resting on the icon peeks. */
    destinationId: string;
    children: (peeks: boolean) => React.ReactNode;
}>) {
    const context = useAppShellPeek();
    const kind = props.destinationId;
    const peeks = context?.peeks(kind) ?? false;
    const onKeyDown = React.useCallback((event: { key?: string; nativeEvent?: { key?: string } }) => {
        const key = event.nativeEvent?.key ?? event.key;
        if (key === 'ArrowRight') context?.openFocused(kind);
    }, [context, kind]);
    // `onKeyDown` reaches a view on the web; the icon inside it keeps its own press and focus.
    const keyProps = { onKeyDown } as object;
    return (
        <View collapsable={false} testID={props.testID} {...(context?.triggerProps(kind) ?? null)} {...keyProps}>
            {props.children(peeks)}
        </View>
    );
}

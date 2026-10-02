import * as React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { TerminalArrowPad } from './TerminalArrowPad';
import type { ArrowPadArea } from './terminalArrowPadGeometry';
import type { TerminalArrowDirection } from './terminalKeyInput';
import type { EmbeddedTerminalCursorRow } from '../embeddedTerminalRendererHandle';

/**
 * The terminal surface with the phone arrow pad floating over it (terminal lab P1). The wrapper is
 * always mounted so the renderer below never remounts when the pad appears; the pad is an overlay,
 * so the PTY keeps its columns.
 */
export const TerminalKeysSurface = React.memo(function TerminalKeysSurface(props: Readonly<{
    children: React.ReactNode;
    showArrowPad: boolean;
    onArrow: (direction: TerminalArrowDirection) => void;
    cursorRow?: EmbeddedTerminalCursorRow | null;
    testIdPrefix?: string | null;
}>) {
    const [area, setArea] = React.useState<ArrowPadArea>({ width: 0, height: 0 });
    const onLayout = React.useCallback((event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setArea((current) => (current.width === width && current.height === height ? current : { width, height }));
    }, []);
    return (
        <View style={{ flex: 1, minHeight: 0, minWidth: 0 }} onLayout={onLayout}>
            {props.children}
            {props.showArrowPad ? (
                <TerminalArrowPad area={area} cursorRow={props.cursorRow} onArrow={props.onArrow} testIdPrefix={props.testIdPrefix} />
            ) : null}
        </View>
    );
});

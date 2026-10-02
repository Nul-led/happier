import * as React from 'react';
import { Keyboard, Platform } from 'react-native';

import {
    applyTerminalKeyModifiers,
    NO_TERMINAL_KEY_MODIFIERS,
    terminalArrowSequence,
    type TerminalArrowDirection,
    type TerminalKeyModifiers,
    type TerminalRailKey,
} from './terminalKeyInput';

function dismissTerminalKeyboard(): void {
    Keyboard.dismiss();
    if (Platform.OS !== 'web') return;
    // The web renderer's input is a hidden textarea, not an RN TextInput, so blur it directly.
    const active = (globalThis as { document?: { activeElement?: { blur?: () => void } | null } }).document?.activeElement;
    active?.blur?.();
}

/**
 * The phone key rail and arrow pad's one input owner: sticky Ctrl/⌥ latch for the next key from the
 * rail, the pad or the soft keyboard, then release. Everything goes through the controller's own
 * `onInput`, so the PTY sees exactly what a hardware keyboard would send.
 */
export function useTerminalKeys(input: Readonly<{
    onInput: (data: string) => void;
    focusRenderer: () => void;
}>) {
    const [modifiers, setModifiers] = React.useState<TerminalKeyModifiers>(NO_TERMINAL_KEY_MODIFIERS);
    const latest = React.useRef({ ...input, modifiers });
    latest.current = { ...input, modifiers };

    const release = React.useCallback(() => {
        if (latest.current.modifiers.ctrl || latest.current.modifiers.alt) setModifiers(NO_TERMINAL_KEY_MODIFIERS);
    }, []);

    /** The renderer's own input (soft keyboard, paste) with any latched modifier applied once. */
    const onInput = React.useCallback((data: string) => {
        const current = latest.current;
        current.onInput(applyTerminalKeyModifiers(data, current.modifiers));
        release();
    }, [release]);

    const pressRailKey = React.useCallback((key: TerminalRailKey) => {
        const current = latest.current;
        if (key.kind === 'hideKeyboard') {
            dismissTerminalKeyboard();
            return;
        }
        if (key.kind === 'modifier') {
            setModifiers((previous) => ({ ...previous, [key.id]: !previous[key.id] }));
            return;
        }
        current.onInput(applyTerminalKeyModifiers(key.data, current.modifiers));
        release();
        current.focusRenderer();
    }, [release]);

    const pressArrow = React.useCallback((direction: TerminalArrowDirection) => {
        const current = latest.current;
        current.onInput(terminalArrowSequence(direction, current.modifiers));
        release();
    }, [release]);

    return { modifiers, onInput, pressRailKey, pressArrow };
}

import * as React from 'react';

import type { KeyboardCommandId } from './types';

export type KeyboardShortcutLabels = Partial<Record<KeyboardCommandId, string>>;

export const NO_KEYBOARD_SHORTCUT_LABELS: KeyboardShortcutLabels = {};

/** Provided by `KeyboardShortcutProvider`: each available command's key combination, as bound. */
export const KeyboardShortcutLabelsContext = React.createContext<KeyboardShortcutLabels>(NO_KEYBOARD_SHORTCUT_LABELS);

/**
 * The key combination that runs a command here, as the person has bound it (for a tooltip beside
 * the control that does the same thing), or undefined when nothing runs it.
 */
export function useKeyboardShortcutLabel(commandId: KeyboardCommandId | undefined): string | undefined {
    const labels = React.useContext(KeyboardShortcutLabelsContext);
    return commandId === undefined ? undefined : labels[commandId];
}

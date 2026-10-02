/**
 * What the phone key rail and the arrow pad send to the PTY (terminal lab P1). Pure, so the latched
 * modifiers and the escape sequences are decided in one place for the rail, the pad and the soft
 * keyboard.
 */
export type TerminalKeyModifiers = Readonly<{ ctrl: boolean; alt: boolean }>;
export type TerminalArrowDirection = 'up' | 'down' | 'left' | 'right';

export const NO_TERMINAL_KEY_MODIFIERS: TerminalKeyModifiers = Object.freeze({ ctrl: false, alt: false });

const ARROW_FINAL: Readonly<Record<TerminalArrowDirection, string>> = { up: 'A', down: 'B', right: 'C', left: 'D' };

function controlCharacter(character: string): string {
    if (character === ' ' || character === '@') return '\u0000';
    if (character === '?') return '\u007f';
    const code = character.toUpperCase().charCodeAt(0);
    // A–Z and [ \ ] ^ _ map to 0x01–0x1f.
    if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code & 0x1f);
    return character;
}

/**
 * A latched modifier applies to the next single key only; pasted text and multi-character input
 * (an IME commit, an Enter-terminated line) pass through untouched.
 */
export function applyTerminalKeyModifiers(data: string, modifiers: TerminalKeyModifiers): string {
    if ((!modifiers.ctrl && !modifiers.alt) || Array.from(data).length !== 1) return data;
    const base = modifiers.ctrl ? controlCharacter(data) : data;
    return modifiers.alt ? `\u001b${base}` : base;
}

/** Cursor keys; a latched modifier uses xterm's `CSI 1;<mod>` form (⌥ = 3, Ctrl = 5, both = 7). */
export function terminalArrowSequence(direction: TerminalArrowDirection, modifiers: TerminalKeyModifiers): string {
    const parameter = 1 + (modifiers.alt ? 2 : 0) + (modifiers.ctrl ? 4 : 0);
    return parameter === 1 ? `\u001b[${ARROW_FINAL[direction]}` : `\u001b[1;${parameter}${ARROW_FINAL[direction]}`;
}

export type TerminalRailKey =
    | Readonly<{ id: 'hideKeyboard'; kind: 'hideKeyboard' }>
    | Readonly<{ id: 'ctrl' | 'alt'; kind: 'modifier' }>
    | Readonly<{ id: string; kind: 'send'; data: string; mono?: boolean }>;

/** The rail's order (lab P1): keyboard-dismiss first, then the keys a phone keyboard lacks. */
export const TERMINAL_RAIL_KEYS: readonly TerminalRailKey[] = [
    { id: 'hideKeyboard', kind: 'hideKeyboard' },
    { id: 'esc', kind: 'send', data: '\u001b' },
    { id: 'tab', kind: 'send', data: '\t' },
    { id: 'ctrl', kind: 'modifier' },
    { id: 'alt', kind: 'modifier' },
    { id: 'ctrlC', kind: 'send', data: '\u0003' },
    { id: 'ctrlD', kind: 'send', data: '\u0004' },
    { id: 'pipe', kind: 'send', data: '|', mono: true },
    { id: 'tilde', kind: 'send', data: '~', mono: true },
    { id: 'slash', kind: 'send', data: '/', mono: true },
    { id: 'dash', kind: 'send', data: '-', mono: true },
    { id: 'backtick', kind: 'send', data: '`', mono: true },
];

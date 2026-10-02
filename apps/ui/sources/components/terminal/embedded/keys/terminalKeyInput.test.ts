import { describe, expect, it } from 'vitest';

import { applyTerminalKeyModifiers, terminalArrowSequence } from './terminalKeyInput';

describe('terminal key input', () => {
    it('turns the next character into its control code while Ctrl is latched', () => {
        expect(applyTerminalKeyModifiers('c', { ctrl: true, alt: false })).toBe('\u0003');
        expect(applyTerminalKeyModifiers('D', { ctrl: true, alt: false })).toBe('\u0004');
        expect(applyTerminalKeyModifiers('[', { ctrl: true, alt: false })).toBe('\u001b');
        expect(applyTerminalKeyModifiers(' ', { ctrl: true, alt: false })).toBe('\u0000');
    });

    it('prefixes Escape while ⌥ is latched, and combines both modifiers', () => {
        expect(applyTerminalKeyModifiers('b', { ctrl: false, alt: true })).toBe('\u001bb');
        expect(applyTerminalKeyModifiers('x', { ctrl: true, alt: true })).toBe('\u001b\u0018');
    });

    it('leaves pasted text and unlatched input unchanged', () => {
        expect(applyTerminalKeyModifiers('ls -la\r', { ctrl: true, alt: true })).toBe('ls -la\r');
        expect(applyTerminalKeyModifiers('c', { ctrl: false, alt: false })).toBe('c');
    });

    it('sends cursor keys, with the xterm modifier parameter when a modifier is latched', () => {
        expect(terminalArrowSequence('up', { ctrl: false, alt: false })).toBe('\u001b[A');
        expect(terminalArrowSequence('down', { ctrl: false, alt: false })).toBe('\u001b[B');
        expect(terminalArrowSequence('right', { ctrl: false, alt: false })).toBe('\u001b[C');
        expect(terminalArrowSequence('left', { ctrl: false, alt: false })).toBe('\u001b[D');
        expect(terminalArrowSequence('left', { ctrl: true, alt: false })).toBe('\u001b[1;5D');
        expect(terminalArrowSequence('up', { ctrl: false, alt: true })).toBe('\u001b[1;3A');
    });
});

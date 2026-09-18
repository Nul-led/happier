import { describe, expect, it } from 'vitest';

import { normalizeSecretPromptInput } from './normalizeSecretInput';

describe('normalizeSecretPromptInput', () => {
    it('returns null only for null or an empty value', () => {
        expect(normalizeSecretPromptInput(null)).toBeNull();
        expect(normalizeSecretPromptInput('')).toBeNull();
        expect(normalizeSecretPromptInput('   ')).toBe('   ');
        expect(normalizeSecretPromptInput('\n\t')).toBe('\n\t');
    });

    it('returns the exact secret value', () => {
        expect(normalizeSecretPromptInput(' abc ')).toBe(' abc ');
        expect(normalizeSecretPromptInput('\nabc\t')).toBe('\nabc\t');
    });

    it('preserves non-empty internal whitespace and control-adjacent content', () => {
        expect(normalizeSecretPromptInput(' key\tvalue ')).toBe(' key\tvalue ');
        expect(normalizeSecretPromptInput('\u2003secret\u2003')).toBe('\u2003secret\u2003');
    });
});

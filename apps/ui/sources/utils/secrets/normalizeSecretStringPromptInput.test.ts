import { describe, expect, it } from 'vitest';

import { normalizeSecretStringPromptInput } from './normalizeSecretStringPromptInput';

describe('normalizeSecretStringPromptInput', () => {
    it('returns null for null input', () => {
        expect(normalizeSecretStringPromptInput(null)).toBeNull();
    });

    it('preserves whitespace-only input as a sealed secret value', () => {
        expect(normalizeSecretStringPromptInput('   ')).toEqual({
            _isSecretValue: true,
            value: '   ',
        });
    });

    it('wraps the exact non-empty input as a sealed secret value', () => {
        expect(normalizeSecretStringPromptInput('  sk-123  ')).toEqual({
            _isSecretValue: true,
            value: '  sk-123  ',
        });
    });
});

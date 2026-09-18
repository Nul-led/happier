import { describe, expect, it } from 'vitest';

import { formatWorkflowUsageLabel } from './workflowUsagePresentation';

describe('formatWorkflowUsageLabel', () => {
    it('uses the incumbent locale-aware token and currency formatters', () => {
        expect(formatWorkflowUsageLabel({
            inputTokens: 120,
            outputTokens: 30,
            costUsd: 0.04,
        }, { tokens: 'Tokens', input: 'Input', output: 'Output' })).toBe(`150 Tokens · ${new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 4,
        }).format(0.04)}`);
    });

    it('does not invent zero-valued dimensions when usage is unavailable', () => {
        const labels = { tokens: 'Tokens', input: 'Input', output: 'Output' };
        expect(formatWorkflowUsageLabel({}, labels)).toBeNull();
        expect(formatWorkflowUsageLabel({ inputTokens: 120 }, labels)).toBe('120 Tokens · Input');
        expect(formatWorkflowUsageLabel({ outputTokens: 30 }, labels)).toBe('30 Tokens · Output');
    });
});

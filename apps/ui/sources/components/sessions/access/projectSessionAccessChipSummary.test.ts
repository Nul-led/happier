import { describe, expect, it } from 'vitest';
import { t } from '@/text';
import { projectSessionAccessChipSummary } from './projectSessionAccessChipSummary';

describe('projectSessionAccessChipSummary', () => {
    it('never calls an incomplete audience private and preserves the admitted safe summary', () => {
        expect(projectSessionAccessChipSummary({ grants: [], audienceComplete: false }).label).toBe(t('session.access.title'));
        const safeSummary = { label: 'Acme', accessibilityLabel: 'Session access, Acme', requiredByTeamPolicy: true };
        expect(projectSessionAccessChipSummary({ grants: [], audienceComplete: false, safeSummary })).toBe(safeSummary);
    });
    it('names the Team context and its policy lock without claiming an audience it never read', () => {
        const contextual = projectSessionAccessChipSummary({ grants: [], audienceComplete: false, contextLabel: 'Acme' });
        expect(contextual.label).toBe('Acme');
        expect(contextual.label).not.toContain(t('session.access.private'));
        expect(contextual.requiredByTeamPolicy).toBe(false);

        const required = projectSessionAccessChipSummary({
            grants: [], audienceComplete: false, contextLabel: 'Acme', requiredByTeamPolicy: true,
        });
        expect(required.label).toContain('Acme');
        expect(required.label).toContain(t('session.access.required'));
        expect(required.requiredByTeamPolicy).toBe(true);
        expect(required.accessibilityLabel).toContain(t('session.access.title'));
    });

    it('distinguishes Team context from a complete private audience', () => {
        const actual = projectSessionAccessChipSummary({ grants: [], audienceComplete: true, contextLabel: 'Acme' });
        expect(actual.label).toContain('Acme');
        expect(actual.label).toContain(t('session.access.private'));
    });
});

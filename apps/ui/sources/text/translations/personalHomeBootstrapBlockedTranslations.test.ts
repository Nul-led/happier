import { describe, expect, it } from 'vitest';

import { flattenTranslationLeaves } from '../../../tools/i18n/translationAudit';
import { personalHomeBootstrapBlockedTranslations } from './personalHomeBootstrapBlockedTranslations';

describe('personalHomeBootstrapBlockedTranslations', () => {
    it('keeps every blocked Personal Home state complete and internally localized', () => {
        const locales = Object.entries(personalHomeBootstrapBlockedTranslations);
        const expectedKeys = flattenTranslationLeaves(personalHomeBootstrapBlockedTranslations.de)
            .map((leaf) => leaf.key)
            .sort();

        expect(locales.map(([locale]) => locale).sort()).toEqual([
            'ca', 'de', 'es', 'fr', 'it', 'ja', 'pl', 'pt', 'ru', 'zh-Hans', 'zh-Hant',
        ]);

        for (const [locale, copy] of locales) {
            const localizedCopy: readonly string[] = [
                ...Object.values(copy.blocked),
                ...Object.values(copy.blockedBody),
            ];
            expect(
                flattenTranslationLeaves(copy).map((leaf) => leaf.key).sort(),
                `${locale} blocked-state shape`,
            ).toEqual(expectedKeys);
            expect(
                localizedCopy.join(' '),
                `${locale} blocked-state terminology`,
            ).not.toMatch(/\b(?:Home|Personal Home)\b/);
        }
    });
});

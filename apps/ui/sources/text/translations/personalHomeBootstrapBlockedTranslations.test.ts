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
            // Product decision: the Home product noun stays English in every locale; no native noun for the object.
            for (const value of localizedCopy) {
                expect(value, `${locale} blocked-state terminology`).toMatch(/\bHome\b/);
                expect(value, `${locale} blocked-state terminology`)
                    .not.toMatch(/zuhause|maison|foyer|hogar|\bcas[ae]\b|\bllar|\bdom(u|em|ie)?\b|(^|[^а-яё])дом(а|ом|е|у)?([^а-яё]|$)|ホーム|之家|家庭/i);
            }
        }
    });
});

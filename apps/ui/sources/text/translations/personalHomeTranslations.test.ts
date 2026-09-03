import { describe, expect, it } from 'vitest';

import { auditTranslations, flattenTranslationLeaves } from '../../../tools/i18n/translationAudit';

import { ca } from './ca';
import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { it as itTranslations } from './it';
import { ja } from './ja';
import { pl } from './pl';
import { pt } from './pt';
import { ru } from './ru';
import { zhHans } from './zh-Hans';
import { zhHant } from './zh-Hant';

describe('Personal Home translations', () => {
    it('keeps the setup surface complete and localized in every supported locale', () => {
        const locales = [
            { code: 'ca', root: ca },
            { code: 'de', root: de },
            { code: 'es', root: es },
            { code: 'fr', root: fr },
            { code: 'it', root: itTranslations },
            { code: 'ja', root: ja },
            { code: 'pl', root: pl },
            { code: 'pt', root: pt },
            { code: 'ru', root: ru },
            { code: 'zh-Hans', root: zhHans },
            { code: 'zh-Hant', root: zhHant },
        ];
        const expectedLeaves = flattenTranslationLeaves(en.personalHome)
            .map((leaf) => `${leaf.key}:${leaf.kind}`)
            .sort();
        expect(expectedLeaves).toContain('settings.restoreCleanupWarningTitle:string');
        expect(expectedLeaves).toContain('settings.restoreCleanupWarningBody:string');
        expect(expectedLeaves).not.toContain('settings.searchTitle:string');
        expect(expectedLeaves).not.toContain('settings.searchIndexing:string');
        const shapeMismatches = locales.flatMap(({ code, root }) => {
            const actualLeaves = flattenTranslationLeaves(root.personalHome)
                .map((leaf) => `${leaf.key}:${leaf.kind}`)
                .sort();
            return JSON.stringify(actualLeaves) === JSON.stringify(expectedLeaves)
                ? []
                : [`${code}: Personal Home translation shape differs from English`];
        });
        const untranslated = Object.values(auditTranslations({ en, locales }))
            .flatMap((report) => report.untranslatedStrings)
            .filter((entry) => entry.key.startsWith('personalHome.bootstrap.') || [
                    'personalHome.settings.installOrUpdateAction',
                    'personalHome.settings.startAction',
                    'personalHome.settings.stopAction',
                    'personalHome.settings.restoreCleanupWarningTitle',
                    'personalHome.settings.restoreCleanupWarningBody',
                ].includes(entry.key));

        expect(shapeMismatches).toEqual([]);
        expect(untranslated).toEqual([]);
    });
});

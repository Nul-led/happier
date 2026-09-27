#!/usr/bin/env node
/**
 * Codemod 5b — page search words to translation keys.
 *
 * Replaces each built-in page's English `keywords: ['…']` literal in `catalog/pageCatalog.tsx` with
 * `keywordsKey: 'settingsSearchKeywords.<pageId>'`, the page's translated comma-separated list in
 * `text/translations/settingsSearchKeywordsTranslations.ts` (mounted in all 12 locales). A page is
 * converted only when the English list there has the same words as the literal, so no search word is
 * lost; any other page is reported. Plugin rows keep host-resolved `keywords`.
 *
 *   node scripts/settingsSurfaces/catalogKeywords.mjs [--write]
 */
import { applyEdits, createRunner, loadEnglish, loadPageCatalog } from './lib.mjs';

const runner = createRunner('catalogKeywords');
const english = loadEnglish();
const catalog = loadPageCatalog();

const normalize = (words) => words.map((word) => word.trim().toLowerCase()).filter(Boolean).sort().join('|');

runner.processFile(catalog.rel, (text) => {
    const { nodes, sourceFile: sf } = loadPageCatalog();
    const edits = [];
    for (const node of nodes) {
        if (!node.keywordsProperty) continue;
        const line = sf.getLineAndCharacterOfPosition(node.keywordsProperty.getStart(sf)).line + 1;
        if (!node.keywords || node.keywords.some((word) => word === null)) { runner.skip(catalog.rel, line, 'keywords are not string literals', node.id); continue; }
        const key = `settingsSearchKeywords.${node.id}`;
        const translatedList = english[key];
        if (typeof translatedList !== 'string') { runner.skip(catalog.rel, line, 'no translation key for this page', key); continue; }
        if (normalize(translatedList.split(',')) !== normalize(node.keywords)) {
            runner.skip(catalog.rel, line, 'English list differs from the literal (update one of them)', `${node.keywords.join(', ')} ≠ ${translatedList}`);
            continue;
        }
        edits.push({ start: node.keywordsProperty.getStart(sf), end: node.keywordsProperty.getEnd(), text: `keywordsKey: '${key}'` });
        runner.match(catalog.rel, line, 'keywords → keywordsKey', node.id);
    }
    return edits.length ? applyEdits(text, edits) : text;
});

runner.finish();

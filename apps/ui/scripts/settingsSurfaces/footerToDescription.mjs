#!/usr/bin/env node
/**
 * Codemod 3 — `footer` → `description` on page groups.
 *
 * On a page, `ItemGroup` renders `description ?? footer` as the section description above the rows,
 * and in grouped presentation both render as the footer, so renaming the prop never changes what a
 * group shows. The rename is applied to groups in files rendered under a page-presented `ItemList`
 * (files containing `presentation="page"` and the settings files they import); groups elsewhere are
 * counted as "not under page presentation" for U8.
 *
 * `--everywhere` also renames groups not yet under page presentation (render-neutral; U8/U10 use).
 *
 *   node scripts/settingsSurfaces/footerToDescription.mjs [--write] [--everywhere] [--only <path-part>]
 */
import { readFileSync } from 'node:fs';

import {
    absOf,
    applyEdits,
    createRunner,
    forEachDescendant,
    getAttr,
    isHandMigrated,
    isJsx,
    isNonPage,
    lineOf,
    listScopeFiles,
    pagePresentedFiles,
    parseSource,
    tagNameOf,
} from './lib.mjs';

const runner = createRunner('footerToDescription');
const { files: pageFiles } = pagePresentedFiles();

for (const rel of listScopeFiles()) {
    if (!runner.selected(rel)) continue;
    const initial = readFileSync(absOf(rel), 'utf8');
    if (!/<ItemGroup[\s\S]*?footer=/.test(initial)) continue;
    const blocked = isHandMigrated(rel) ? 'hand-migrated page' : isNonPage(rel) ? 'not page content (shell/catalog/menu/picker)' : !pageFiles.has(rel) && !process.argv.includes('--everywhere') ? 'not under page presentation yet' : null;
    runner.processFile(rel, (text) => {
        const sf = parseSource(rel, text);
        const edits = [];
        forEachDescendant(sf, (node) => {
            if (!isJsx(node) || tagNameOf(node) !== 'ItemGroup') return undefined;
            const footer = getAttr(node, 'footer');
            if (!footer) return undefined;
            const line = lineOf(sf, footer.getStart(sf));
            if (blocked) { runner.skip(rel, line, blocked); return undefined; }
            if (getAttr(node, 'description')) { runner.skip(rel, line, 'group has both footer and description'); return undefined; }
            edits.push({ start: footer.name.getStart(sf), end: footer.name.getEnd(), text: 'description' });
            runner.match(rel, line, 'footer → description');
            return undefined;
        });
        return edits.length ? applyEdits(text, edits) : text;
    });
}

runner.finish({ pagePresentedFiles: pageFiles.size });

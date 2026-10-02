#!/usr/bin/env node
/**
 * Codemod 3 — `footer` → `description` on page groups.
 *
 * Before U10, `ItemGroup` rendered `description ?? footer` above page rows and below grouped rows.
 * `description` now owns both placements. The rename is applied to groups under a page `ItemList`
 * (files with default or explicit page lists and the settings files they import); groups elsewhere are
 * counted as "not under page presentation" for U8.
 *
 * `--everywhere` also renames groups not yet under page presentation (render-neutral; U8/U10 use).
 * `--contract` visits every UI source and test, including hand-migrated and grouped surfaces.
 *
 *   node scripts/settingsSurfaces/footerToDescription.mjs [--write] [--everywhere|--contract] [--only <path-part>]
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
    listUiFiles,
    pagePresentedFiles,
    parseSource,
    tagNameOf,
} from './lib.mjs';

const runner = createRunner('footerToDescription');
const { files: pageFiles } = pagePresentedFiles();
const contraction = process.argv.includes('--contract');

for (const rel of contraction ? listUiFiles({ includeTests: true }) : listScopeFiles()) {
    if (!runner.selected(rel)) continue;
    const initial = readFileSync(absOf(rel), 'utf8');
    if (!/<ItemGroup[\s\S]*?footer=/.test(initial)) continue;
    const blocked = contraction ? null : isHandMigrated(rel) ? 'hand-migrated page' : isNonPage(rel) ? 'not page content (shell/catalog/menu/picker)' : !pageFiles.has(rel) && !process.argv.includes('--everywhere') ? 'not under page presentation yet' : null;
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

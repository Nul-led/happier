#!/usr/bin/env node
/**
 * Codemod 1 — page presentation.
 *
 * For every settings route whose screen renders an `ItemList` as its whole page, adds
 * `presentation="page"` to that `ItemList` and a `<SettingsPageHeader />` as its first child. The
 * header's title comes from the route registry at runtime; its description is the catalog subtitle of
 * the route when the catalog has one.
 *
 * Follows the route's default export to the component that renders the page (through imports and
 * single-element wrappers), and transforms every `return <ItemList …>` of that component (loading,
 * empty and loaded states all get the header).
 *
 * Skips (reported): hand-migrated pages, routes without a static registry title, entity pages (the
 * last route segment is dynamic: they need an entity header), components outside the settings
 * scope, roots that are not an `ItemList`, and `ItemList`s that already choose a presentation.
 *
 *   node scripts/settingsSurfaces/pagePresentation.mjs [--write] [--only <path-part>]
 */
import { findComponent, resolvePage, rootReturns } from './pageResolution.mjs';
import {
    applyEdits,
    attrExpression,
    createRunner,
    ensureNamedImport,
    forEachDescendant,
    getAttr,
    indentAt,
    isFunctionLike,
    isHandMigrated,
    isInScope,
    isJsx,
    lineOf,
    listScopeFiles,
    loadPageCatalog,
    loadRouteRegistry,
    openingOf,
    parseSource,
    routeOfFile,
    routeTitle,
    SETTINGS_ROUTES_DIR,
    tagNameOf,
    ts,
} from './lib.mjs';

const runner = createRunner('pagePresentation');
const registry = loadRouteRegistry();
const catalog = loadPageCatalog();

const visitedComponents = new Set();

const catalogByRoute = new Map(catalog.nodes.filter((node) => node.route).map((node) => [node.route, node]));
const routeFiles = listScopeFiles().filter((rel) => rel.startsWith(`${SETTINGS_ROUTES_DIR}/`) && !rel.endsWith('/_layout.tsx'));

/** Why a route cannot take the page header itself, or null when it can. */
function routeIneligibility(rel, name) {
    if (isHandMigrated(rel)) return { reason: 'hand-migrated page' };
    const definition = routeTitle(registry, name);
    if (!definition || !definition.titleKey || definition.headerShown === false) {
        return { reason: 'no static route title in settingsRouteRegistry', detail: definition?.headerShown === false ? 'headerShown: false' : 'unregistered' };
    }
    const segments = name.replace(/\/index$/, '').split('/');
    if (/^\[.*\]$/.test(segments[segments.length - 1])) {
        return { reason: 'entity page (dynamic last segment): needs an entity header' };
    }
    return null;
}

// Resolve every route first: a component shared with an ineligible route (an entity page, a
// hand-migrated page) is left alone, because the header would land on that route too.
const resolved = [];
for (const rel of routeFiles) {
    const { name, url } = routeOfFile(rel);
    const ineligible = routeIneligibility(rel, name);
    const routeComponent = findComponent(rel, 'default');
    const page = routeComponent ? resolvePage(routeComponent) : { error: 'no default-exported component found' };
    resolved.push({ rel, url, ineligible, page });
}
const routesByComponent = new Map();
for (const entry of resolved) {
    if (entry.page.error) continue;
    const key = `${entry.page.component.rel}#${entry.page.component.fn.pos}`;
    const list = routesByComponent.get(key) ?? [];
    list.push(entry);
    routesByComponent.set(key, list);
}

/** Pages whose top already is a bespoke identity composition (a generic header would duplicate it). */
const OWN_COMPOSITION = {
    'sources/components/settings/SettingsView.tsx': 'Overview: app/profile header card (lab O1, U8 f)',
};

const pages = [];
for (const entry of resolved) {
    const { rel, url, ineligible, page } = entry;
    if (!runner.selected(rel) && !(page.component && runner.selected(page.component.rel))) continue;
    if (ineligible) { runner.skip(rel, 1, ineligible.reason, ineligible.detail ?? url); continue; }
    if (page.error) { runner.skip(rel, 1, page.error, page.detail); continue; }
    const componentRel = page.component.rel;
    if (!isInScope(componentRel)) { runner.skip(rel, 1, 'page component outside settings scope', componentRel); continue; }
    if (isHandMigrated(componentRel)) { runner.skip(rel, 1, 'hand-migrated page', componentRel); continue; }
    if (OWN_COMPOSITION[componentRel]) { runner.skip(rel, 1, 'page has its own header composition', OWN_COMPOSITION[componentRel]); continue; }
    const key = `${componentRel}#${page.component.fn.pos}`;
    const sharers = routesByComponent.get(key);
    const blocking = sharers.filter((other) => other.ineligible);
    if (blocking.length > 0) {
        runner.skip(rel, 1, 'page component shared with an ineligible route', `${componentRel} ← ${blocking.map((other) => routeOfFile(other.rel).url).join(', ')}`);
        continue;
    }
    if (page.otherReturns.some((expr) => isJsx(expr))) {
        const tags = page.otherReturns.filter((expr) => isJsx(expr)).map((expr) => `<${tagNameOf(expr)}> @${lineOf(page.component.sf, expr.getStart(page.component.sf))}`);
        runner.skip(rel, 1, 'mixed page roots (some states are not an ItemList)', `${componentRel}: ${[...new Set(tags)].join(', ')}`);
        continue;
    }
    if (visitedComponents.has(key)) continue;
    visitedComponents.add(key);
    const subtitles = new Set(sharers.map((other) => catalogByRoute.get(other.url)?.subtitleKey ?? null));
    const subtitleKey = subtitles.size === 1 ? [...subtitles][0] : null;
    pages.push({ rel, url: sharers.map((other) => other.url).join(' + '), componentRel, fnPos: page.component.fn.pos, subtitleKey, otherReturns: page.otherReturns.map((expr) => (isJsx(expr) ? `<${tagNameOf(expr)}> @${lineOf(page.component.sf, expr.getStart(page.component.sf))}` : ts.SyntaxKind[expr.kind])) });
}

const byComponentFile = new Map();
for (const page of pages) {
    const list = byComponentFile.get(page.componentRel) ?? [];
    list.push(page);
    byComponentFile.set(page.componentRel, list);
}

for (const [componentRel, filePages] of byComponentFile) {
    runner.processFile(componentRel, (text) => {
        const sf = parseSource(componentRel, text);
        const edits = [];
        let needsT = false;
        for (const page of filePages) {
            let fn = null;
            forEachDescendant(sf, (node) => {
                if (!fn && isFunctionLike(node) && node.pos === page.fnPos) fn = node;
                return undefined;
            });
            if (!fn) { runner.skip(componentRel, 1, 'component moved while planning'); continue; }
            const itemLists = rootReturns(fn).filter((expr) => expr && isJsx(expr) && tagNameOf(expr) === 'ItemList');
            if (page.otherReturns.length > 0) runner.skip(componentRel, lineOf(sf, fn.getStart(sf)), 'some states render without ItemList (header added only to ItemList states)', `${page.url}: ${page.otherReturns.join(', ')}`);
            for (const itemList of itemLists) {
                const line = lineOf(sf, itemList.getStart(sf));
                if (getAttr(itemList, 'presentation')) {
                    const value = attrExpression(getAttr(itemList, 'presentation'));
                    runner.skip(componentRel, line, 'ItemList already chooses a presentation', value?.getText(sf));
                    continue;
                }
                if (!ts.isJsxElement(itemList)) { runner.skip(componentRel, line, 'ItemList has no children'); continue; }
                let hasHeader = false;
                forEachDescendant(itemList, (node) => {
                    if (isJsx(node) && ['SettingsPageHeader', 'PageHeader'].includes(tagNameOf(node))) hasHeader = true;
                    return undefined;
                });
                const opening = openingOf(itemList);
                const attrs = opening.attributes.properties;
                if (attrs.length === 0) {
                    edits.push({ start: opening.tagName.getEnd(), end: opening.tagName.getEnd(), text: ' presentation="page"' });
                } else {
                    const last = attrs[attrs.length - 1];
                    const multiline = sf.getLineAndCharacterOfPosition(last.getStart(sf)).line !== sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line;
                    edits.push({
                        start: last.getEnd(),
                        end: last.getEnd(),
                        text: multiline ? `\n${indentAt(text, last.getStart(sf))}presentation="page"` : ' presentation="page"',
                    });
                }
                if (hasHeader) {
                    runner.match(componentRel, line, 'presentation added (header already present)', page.url);
                    continue;
                }
                const firstChild = itemList.children.find((child) => !(ts.isJsxText(child) && /^\s*$/.test(child.text)));
                const header = page.subtitleKey
                    ? `<SettingsPageHeader description={t('${page.subtitleKey}')} />`
                    : '<SettingsPageHeader />';
                if (page.subtitleKey) needsT = true;
                if (firstChild) {
                    const start = firstChild.getStart(sf);
                    const sameLine = sf.getLineAndCharacterOfPosition(start).line === sf.getLineAndCharacterOfPosition(opening.getEnd()).line;
                    edits.push({ start, end: start, text: sameLine ? header : `${header}\n${indentAt(text, start)}` });
                } else {
                    const at = itemList.closingElement.getStart(sf);
                    const indent = indentAt(text, itemList.getStart(sf));
                    edits.push({ start: itemList.openingElement.getEnd(), end: at, text: `\n${indent}    ${header}\n${indent}` });
                }
                runner.match(componentRel, line, page.subtitleKey ? 'page + header (catalog description)' : 'page + header (no catalog description)', page.url);
            }
        }
        if (edits.length === 0) return text;
        let next = applyEdits(text, edits);
        if (next.includes('<SettingsPageHeader')) next = ensureNamedImport(next, componentRel, 'SettingsPageHeader', '@/components/settings/shell/SettingsPageHeader');
        if (needsT) next = ensureNamedImport(next, componentRel, 't', '@/text');
        return next;
    });
}

runner.finish({ pagesPlanned: pages.length });

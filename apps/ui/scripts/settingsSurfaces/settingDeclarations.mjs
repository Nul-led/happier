#!/usr/bin/env node
/**
 * Codemod 5 — setting declarations for search.
 *
 * For each catalog page (a page id with a route) whose page component is resolved, finds the setting
 * rows its component file renders directly, generates the page's `defineSettingsPage` module, registers
 * it in `settingsPageDeclarations.ts`, and renders each row from its declaration:
 *
 * - `Item` → `SettingRow` (title and static description come from the declaration; a dynamic
 *   subtitle stays as the row's `subtitle` override);
 * - `SegmentedChoiceItem` and `DropdownMenu` rows → wrapped in `SettingAnchor`, title read from the
 *   declaration.
 *
 * A setting row has a static `t('key')` title and a control: a `rightElement`, a segmented or dropdown
 * control, or a destination (an `onPress` that navigates, with its chevron). Operations (`showChevron={false}` with an
 * `onPress`), status/info rows, rows built by `.map()`, rows outside an `ItemGroup`, and rows with a
 * dynamic title are not settings and are reported. A row whose description is dynamic (its current
 * value) declares no description, like the Sessions reference.
 *
 * Rows in section files the page imports exclusively (no other settings file imports them) are
 * declared on the same page; section files shared between pages are reported for U8.
 *
 *   node scripts/settingsSurfaces/settingDeclarations.mjs [--write] [--only <path-part>]
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
    absOf,
    applyEdits,
    attrExpression,
    createRunner,
    ensureNamedImport,
    forEachDescendant,
    getAttr,
    indentAt,
    isHandMigrated,
    isInScope,
    isNonPage,
    isJsx,
    lineOf,
    listScopeFiles,
    loadPageCatalog,
    localImports,
    openingOf,
    parseSource,
    removeImportIfUnused,
    SETTINGS_COMPONENTS_DIR,
    SETTINGS_ROUTES_DIR,
    staticTKey,
    tagNameOf,
    ts,
    unwrap,
} from './lib.mjs';
import { findComponent, resolvePage } from './pageResolution.mjs';

const runner = createRunner('settingDeclarations');
const catalog = loadPageCatalog();
const REGISTRY_REL = 'sources/components/settings/catalog/settingsPageDeclarations.ts';
const ROW_TAGS = new Set(['Item', 'SegmentedChoiceItem', 'DropdownMenu']);

// Pages that already declare their settings (hand-migrated references).
const declaredPageIds = new Set();
for (const rel of listScopeFiles({ tsxOnly: false })) {
    if (!rel.endsWith('.ts')) continue;
    const text = readFileSync(absOf(rel), 'utf8');
    const match = /defineSettingsPage\(\{\s*pageId:\s*'([^']+)'/.exec(text);
    if (match) declaredPageIds.add(match[1]);
}

function camel(value) {
    return value.replace(/[-_ ]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase()).replace(/^[A-Z]/, (c) => c.toLowerCase());
}

/** `settingsX.commitStrategy.title` → `commitStrategy`; `settingsSession.startWithTitle` → `startWith`. */
function idFromKey(key) {
    const parts = key.split('.');
    let last = parts[parts.length - 1];
    if (/^(title|label|name|header|triggerTitle)$/i.test(last) && parts.length > 1) last = parts[parts.length - 2];
    last = last.replace(/(Title|Label)$/, '');
    return camel(last || parts[parts.length - 2] || 'setting');
}

function upperSnake(value) {
    return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

function insideMap(node, stop) {
    let current = node.parent;
    while (current && current !== stop) {
        if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isCallExpression(current.parent)) {
            const callee = current.parent.expression;
            if (ts.isPropertyAccessExpression(callee) && ['map', 'flatMap', 'filter'].includes(callee.name.text)) return true;
        }
        current = current.parent;
    }
    return false;
}

function nearestAncestorTag(node, tags) {
    let current = node.parent;
    while (current) {
        if (isJsx(current) && tags.includes(tagNameOf(current))) return current;
        current = current.parent;
    }
    return null;
}

function isConditional(node, group) {
    let current = node.parent;
    while (current && current !== group) {
        if (ts.isConditionalExpression(current) || (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) return true;
        current = current.parent;
    }
    return false;
}

/** The title key and description key of a row element, or why it is not a setting row. */
function describeRow(row, sf) {
    const tag = tagNameOf(row);
    if (tag === 'DropdownMenu') {
        const trigger = attrExpression(getAttr(row, 'itemTrigger'));
        if (!trigger || !ts.isObjectLiteralExpression(trigger)) return { not: 'dropdown without a row trigger' };
        const title = trigger.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'title');
        const titleKey = title ? staticTKey(title.initializer) : null;
        if (!titleKey) return { not: 'dynamic title' };
        return { titleKey, titleNode: title.initializer, control: 'dropdown' };
    }
    const titleExpr = attrExpression(getAttr(row, 'title'));
    const titleKey = titleExpr ? staticTKey(titleExpr) : null;
    if (!titleKey) return { not: 'dynamic title' };
    const subtitleAttr = getAttr(row, 'subtitle');
    const subtitleExpr = subtitleAttr ? attrExpression(subtitleAttr) : null;
    const descriptionKey = subtitleExpr ? staticTKey(subtitleExpr) : null;
    if (tag === 'SegmentedChoiceItem') return { titleKey, descriptionKey, titleNode: titleExpr, control: 'segmented' };
    const hasRight = !!getAttr(row, 'rightElement');
    const onPress = getAttr(row, 'onPress');
    const chevron = attrExpression(getAttr(row, 'showChevron'));
    const noChevron = chevron && chevron.kind === ts.SyntaxKind.FalseKeyword;
    if (getAttr(row, 'destructive') || (attrExpression(getAttr(row, 'mode'))?.getText(sf) ?? '').includes('info')) return { not: 'operation or info row' };
    const navigates = onPress && /\b(router\.(push|navigate|replace)|navigation\.navigate|push\(|openSettings|href)/.test(onPress.getText(sf));
    if (!hasRight && !(onPress && !noChevron && navigates)) {
        return { not: !onPress ? 'status/info row (no control)' : noChevron ? 'operation row (no chevron)' : 'operation row (opens a dialog or runs an action)' };
    }
    return { titleKey, descriptionKey, dynamicSubtitle: !!subtitleAttr && !descriptionKey, titleNode: titleExpr, control: hasRight ? 'control' : 'destination' };
}

// Resolve every catalog page to its page component file.
const pagesByFile = new Map();
for (const node of catalog.nodes) {
    if (!node.route || !node.route.startsWith('/settings')) continue;
    if (declaredPageIds.has(node.id)) { runner.skip(`catalog:${node.id}`, 0, 'page already declares its settings'); continue; }
    const suffix = node.route === '/settings' ? 'index' : node.route.slice('/settings/'.length);
    const candidates = [`${SETTINGS_ROUTES_DIR}/${suffix}.tsx`, `${SETTINGS_ROUTES_DIR}/${suffix}/index.tsx`];
    const routeRel = candidates.find((candidate) => existsSync(absOf(candidate)));
    if (!routeRel) { runner.skip(`catalog:${node.id}`, 0, 'page route is outside settings routes', node.route); continue; }
    if (isHandMigrated(routeRel)) { runner.skip(routeRel, 1, 'hand-migrated page'); continue; }
    const component = findComponent(routeRel, 'default');
    const page = component ? resolvePage(component) : { error: 'no component' };
    if (page.error) { runner.skip(routeRel, 1, `page component not resolved: ${page.error}`, page.detail); continue; }
    const rel = page.component.rel;
    if (!isInScope(rel) || isHandMigrated(rel)) { runner.skip(routeRel, 1, 'page component outside scope or hand-migrated', rel); continue; }
    if (rel === 'sources/components/settings/SettingsView.tsx') { runner.skip(routeRel, 1, 'overview navigation (no settings of its own)'); continue; }
    if (pagesByFile.has(rel)) { runner.skip(routeRel, 1, 'page component shared with another catalog page', rel); continue; }
    pagesByFile.set(rel, { pageId: node.id, route: node.route, routeRel });
}

const registrations = [];

// Import graph over the settings scope, to find section files a page imports exclusively.
const scopeFiles = listScopeFiles();
const importersOf = new Map();
for (const rel of scopeFiles) {
    for (const target of localImports(rel, readFileSync(absOf(rel), 'utf8'))) {
        if (!importersOf.has(target)) importersOf.set(target, new Set());
        importersOf.get(target).add(rel);
    }
}
const pageFileSet = new Set(pagesByFile.keys());

/** The page file plus section files only it (directly or through its own sections) imports. */
function pageFiles(rel) {
    const files = [rel];
    const seen = new Set(files);
    for (let index = 0; index < files.length; index += 1) {
        for (const target of localImports(files[index], readFileSync(absOf(files[index]), 'utf8'))) {
            if (seen.has(target) || !isInScope(target) || !target.endsWith('.tsx') || isNonPage(target) || isHandMigrated(target) || pageFileSet.has(target)) continue;
            const importers = importersOf.get(target) ?? new Set();
            if ([...importers].every((importer) => seen.has(importer))) {
                seen.add(target);
                files.push(target);
            } else {
                sharedSections.add(target);
            }
        }
    }
    return files;
}
const sharedSections = new Set();

/**
 * Rewrites the setting rows of one file to render from `constName`, collecting their declarations
 * into `page.sections`. Returns whether the file has rows.
 */
function declareRowsInFile(rel, page, constName, moduleSpec) {
    let local = null;
    runner.processFile(rel, (text) => {
        const sf = parseSource(rel, text);
        const edits = [];
        const sections = new Map();
        const usedIds = new Set(page.usedIds);
        let rowCount = 0;
        let untitled = page.untitled;
        forEachDescendant(sf, (node) => {
            if (!isJsx(node) || !ROW_TAGS.has(tagNameOf(node))) return undefined;
            const line = lineOf(sf, node.getStart(sf));
            if (tagNameOf(node) === 'Item' && nearestAncestorTag(node, ['DropdownMenu'])) return undefined;
            if (nearestAncestorTag(node, ['SettingAnchor', 'SettingRow'])) return undefined;
            const described = describeRow(node, sf);
            if (described.not) { if (described.not !== 'dropdown without a row trigger') runner.skip(rel, line, `not a setting row: ${described.not}`); return undefined; }
            const group = nearestAncestorTag(node, ['ItemGroup']);
            if (!group) { runner.skip(rel, line, 'setting row outside an ItemGroup'); return undefined; }
            if (insideMap(node, group)) { runner.skip(rel, line, 'row built by .map() (collection or dynamic options)'); return undefined; }
            if (ts.isJsxElement(node) && tagNameOf(node) !== 'DropdownMenu') { runner.skip(rel, line, 'row with children'); return undefined; }
            if (openingOf(node).attributes.properties.some((attr) => ts.isJsxSpreadAttribute(attr))) { runner.skip(rel, line, 'row spreads props'); return undefined; }
            const groupTitleKey = staticTKey(attrExpression(getAttr(group, 'title')));
            const sectionId = groupTitleKey ? idFromKey(groupTitleKey) : `section${++untitled}`;
            if (!sections.has(sectionId)) sections.set(sectionId, { titleKey: groupTitleKey, settings: new Map() });
            const baseId = idFromKey(described.titleKey);
            let settingId = baseId;
            if (usedIds.has(settingId)) settingId = `${sectionId}${baseId[0].toUpperCase()}${baseId.slice(1)}`;
            for (let counter = 2; usedIds.has(settingId); counter += 1) settingId = `${baseId}${counter}`;
            usedIds.add(settingId);
            sections.get(sectionId).settings.set(settingId, { titleKey: described.titleKey, descriptionKey: described.descriptionKey ?? null });
            rowCount += 1;
            const ref = `${constName}.settings.${settingId}`;
            const tag = tagNameOf(node);
            if (tag === 'Item') {
                const opening = openingOf(node);
                edits.push({ start: opening.tagName.getStart(sf), end: opening.tagName.getEnd(), text: 'SettingRow' });
                const titleAttr = getAttr(node, 'title');
                edits.push({ start: titleAttr.getStart(sf), end: titleAttr.getEnd(), text: `setting={${ref}}` });
                if (described.descriptionKey) {
                    const subtitleAttr = getAttr(node, 'subtitle');
                    const start = subtitleAttr.getStart(sf);
                    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
                    const lineEnd = text.indexOf('\n', subtitleAttr.getEnd());
                    const alone = /^\s*$/.test(text.slice(lineStart, start)) && /^\s*$/.test(text.slice(subtitleAttr.getEnd(), lineEnd));
                    edits.push(alone ? { start: lineStart, end: lineEnd + 1, text: '' } : { start: start - 1, end: subtitleAttr.getEnd(), text: '' });
                }
            } else {
                edits.push({ start: described.titleNode.getStart(sf), end: described.titleNode.getEnd(), text: `t(${ref}.titleKey)` });
                const indent = indentAt(text, node.getStart(sf));
                edits.push({ start: node.getStart(sf), end: node.getStart(sf), text: `<SettingAnchor setting={${ref}}>\n${indent}    ` });
                edits.push({ start: node.getEnd(), end: node.getEnd(), text: `\n${indent}</SettingAnchor>`, reindent: { start: node.getStart(sf), end: node.getEnd() } });
            }
            runner.match(rel, line, `${tag === 'Item' ? 'Item → SettingRow' : `${tag} anchored`} (${described.control}${described.descriptionKey ? ', described' : described.dynamicSubtitle ? ', value subtitle' : ''}${isConditional(node, group) ? ', conditional' : ''})`, `${page.pageId}.${settingId}`);
            return undefined;
        });
        local = { sections, usedIds, rowCount, untitled };
        if (rowCount === 0) return text;
        const lineEdits = [];
        for (const range of edits.filter((edit) => edit.reindent).map((edit) => edit.reindent)) {
            let position = text.indexOf('\n', range.start);
            while (position !== -1 && position < range.end) {
                lineEdits.push({ start: position + 1, end: position + 1, text: '    ' });
                position = text.indexOf('\n', position + 1);
            }
        }
        let next = applyEdits(text, [...edits.map(({ start, end, text: value }) => ({ start, end, text: value })), ...lineEdits]);
        if (next.includes('<SettingRow')) next = ensureNamedImport(next, rel, 'SettingRow', '@/components/settings/shell/SettingRow');
        if (next.includes('<SettingAnchor')) next = ensureNamedImport(next, rel, 'SettingAnchor', '@/components/settings/shell/SettingRow');
        next = ensureNamedImport(next, rel, constName, moduleSpec);
        if (next.includes(`t(${constName}`)) next = ensureNamedImport(next, rel, 't', '@/text');
        next = removeImportIfUnused(next, rel, 'Item');
        return next;
    });
    if (!local || local.rowCount === 0) return false;
    for (const [sectionId, section] of local.sections) {
        const existing = page.sections.get(sectionId);
        if (!existing) page.sections.set(sectionId, section);
        else for (const [id, declaration] of section.settings) existing.settings.set(id, declaration);
    }
    page.usedIds = local.usedIds;
    page.untitled = local.untitled;
    return true;
}

for (const [rel, pageInfo] of pagesByFile) {
    if (!runner.selected(rel)) continue;
    const constName = `${upperSnake(pageInfo.pageId)}_SETTINGS`;
    // Route files cannot host modules (every file under app/ is a route): a route-file page's module
    // goes to its domain folder under components/settings (first route segment), else its page id.
    const domainDir = `${SETTINGS_COMPONENTS_DIR}/${pageInfo.route.split('/')[2] ?? pageInfo.pageId}`;
    const moduleDir = rel.startsWith(`${SETTINGS_ROUTES_DIR}/`)
        ? (existsSync(absOf(domainDir)) ? domainDir : `${SETTINGS_COMPONENTS_DIR}/${pageInfo.pageId}`)
        : path.posix.dirname(rel);
    const moduleRel = `${moduleDir}/${pageInfo.pageId}Settings.ts`;
    const moduleSpec = `@/${moduleRel.slice('sources/'.length).replace(/\.ts$/, '')}`;
    if (existsSync(absOf(moduleRel))) { runner.skip(rel, 1, 'declaration module already exists', moduleRel); continue; }
    const page = { pageId: pageInfo.pageId, sections: new Map(), usedIds: new Set(), untitled: 0 };
    let any = false;
    for (const file of pageFiles(rel)) any = declareRowsInFile(file, page, constName, moduleSpec) || any;
    if (!any) { runner.skip(rel, 1, 'page renders no declarable setting rows in its own files', pageInfo.pageId); continue; }

    const sectionLines = [];
    for (const [sectionId, section] of page.sections) {
        sectionLines.push(`        ${sectionId}: {`);
        if (section.titleKey) sectionLines.push(`            titleKey: '${section.titleKey}',`);
        sectionLines.push('            settings: {');
        for (const [settingId, declaration] of section.settings) {
            const description = declaration.descriptionKey ? `, descriptionKey: '${declaration.descriptionKey}'` : '';
            sectionLines.push(`                ${settingId}: { titleKey: '${declaration.titleKey}'${description} },`);
        }
        sectionLines.push('            },');
        sectionLines.push('        },');
    }
    const content = [
        "import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';",
        '',
        `/** The searchable settings of the \`${pageInfo.pageId}\` page. Rows render their labels from these declarations. */`,
        `export const ${constName} = defineSettingsPage({`,
        `    pageId: '${pageInfo.pageId}',`,
        '    sections: {',
        ...sectionLines,
        '    },',
        '});',
        '',
    ].join('\n');
    runner.createFile(moduleRel, content);
    registrations.push({ constName, moduleSpec });
}
for (const rel of sharedSections) runner.skip(rel, 1, 'section file shared between pages (declare by hand in U8)');

// Register the new declarations.
if (registrations.length) {
    runner.processFile(REGISTRY_REL, (text) => {
        // New imports go after the last page-declaration import, keeping the relative type import last.
        let next = text;
        const importSf = parseSource(REGISTRY_REL, next);
        const declarationImports = importSf.statements.filter((statement) => ts.isImportDeclaration(statement) && statement.moduleSpecifier.text.startsWith('@/components/settings/'));
        const anchor = declarationImports[declarationImports.length - 1];
        const missing = registrations.filter(({ constName }) => !next.includes(`{ ${constName} }`));
        if (anchor && missing.length) {
            const at = next.indexOf('\n', anchor.getEnd()) + 1;
            next = applyEdits(next, [{ start: at, end: at, text: missing.map(({ constName, moduleSpec }) => `import { ${constName} } from '${moduleSpec}';\n`).join('') }]);
        }
        for (const { constName, moduleSpec } of registrations) next = ensureNamedImport(next, REGISTRY_REL, constName, moduleSpec);
        const sf = parseSource(REGISTRY_REL, next);
        let array = null;
        forEachDescendant(sf, (node) => {
            if (ts.isVariableDeclaration(node) && node.name.getText(sf) === 'SETTINGS_PAGE_DECLARATIONS') array = unwrap(node.initializer);
            return undefined;
        });
        const last = array.elements[array.elements.length - 1];
        const indent = indentAt(next, last.getStart(sf));
        const insertAt = last.getEnd() + (next.slice(last.getEnd()).startsWith(',') ? 1 : 0);
        const prefix = next.slice(last.getEnd()).startsWith(',') ? '' : ',';
        return applyEdits(next, [{ start: insertAt, end: insertAt, text: `${prefix}\n${registrations.map(({ constName }) => `${indent}${constName},`).join('\n')}` }]);
    });
}

runner.finish({ pagesResolved: pagesByFile.size, declarationsGenerated: registrations.length });

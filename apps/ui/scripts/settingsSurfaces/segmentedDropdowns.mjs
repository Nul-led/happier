#!/usr/bin/env node
/**
 * Codemod 4 — static 2–3-option dropdown rows → `SegmentedChoiceItem`.
 *
 * Converts a `DropdownMenu` row (`itemTrigger`) whose options are 2–3 static objects
 * `{ id: 'literal', title: t('key'), subtitle?: t('key') }` with short labels (English ≤ 14
 * characters) into a `SegmentedChoiceItem`:
 *
 * - `title`, `subtitle` and `itemProps.testID` of the trigger carry over;
 * - option subtitles become option `description`s, which the row shows for the chosen option — the
 *   same text the dropdown row showed (`showSelectedSubtitle` defaults to true); a row that pinned
 *   its own description instead (`showSelectedSubtitle: false`) is reported;
 * - a trigger subtitle that only names the chosen option is dropped (the control shows it);
 * - `selectedId` → `value`, `onSelect` → `onChange`;
 * - the menu's open state (`const [open, setOpen] = useState(false)`) is deleted together with its
 *   `setOpen(false)` calls and dependency-array entries; the options constant is deleted when nothing
 *   else reads it.
 *
 * Reported instead of converted: dynamic options (spreads, maps, helper calls, non-literal ids),
 * more or fewer than 2–3 options, long labels, extra option behaviour (disabled, icons that are not
 * decoration, categories…), extra menu props (search, custom trigger, formatter), and open state used
 * for anything else.
 *
 *   node scripts/settingsSurfaces/segmentedDropdowns.mjs [--write] [--only <path-part>]
 */
import { readFileSync } from 'node:fs';

import {
    absOf,
    applyEdits,
    attrExpression,
    createRunner,
    ensureNamedImport,
    findEnclosingFunction,
    forEachDescendant,
    getAttr,
    indentAt,
    isHandMigrated,
    isJsx,
    isNonPage,
    lineOf,
    listScopeFiles,
    loadEnglish,
    openingOf,
    parseSource,
    removalEditForNode,
    removeImportIfUnused,
    references,
    removeUnusedLocals,
    removeUnusedThemeHook,
    staticTKey,
    tagNameOf,
    ts,
    unwrap,
} from './lib.mjs';

const MAX_LABEL = 14;
const MENU_PROPS = new Set(['open', 'onOpenChange', 'variant', 'search', 'selectedId', 'showCategoryTitles', 'matchTriggerWidth', 'connectToTrigger', 'rowKind', 'popoverBoundaryRef', 'items', 'onSelect', 'itemTrigger', 'disabled']);
const TRIGGER_PROPS = new Set(['title', 'subtitle', 'showSelectedSubtitle', 'showSelectedDetail', 'itemProps']);
const OPTION_PROPS = new Set(['id', 'title', 'subtitle', 'icon']);

const runner = createRunner('segmentedDropdowns');
const english = loadEnglish();

function prop(object, name, sf) {
    return object.properties.find((candidate) => ts.isPropertyAssignment(candidate) && candidate.name.getText(sf) === name) ?? null;
}

/** `const X = [...]`, `const X = useMemo(() => [...])` in scope → `{ array, statement }`. */
function resolveItems(expr, scope, sf) {
    const node = unwrap(expr);
    if (ts.isArrayLiteralExpression(node)) return { array: node, statement: null, name: null };
    if (!ts.isIdentifier(node)) return null;
    let found = null;
    const search = (root) => forEachDescendant(root, (candidate) => {
        if (found) return false;
        if (ts.isVariableStatement(candidate) && candidate.declarationList.declarations.length === 1) {
            const declaration = candidate.declarationList.declarations[0];
            if (declaration.name.getText(sf) !== node.text || !declaration.initializer) return undefined;
            let init = unwrap(declaration.initializer);
            if (ts.isCallExpression(init) && /(^|\.)useMemo$/.test(init.expression.getText(sf))) {
                const fn = init.arguments[0];
                init = null;
                if (fn && ts.isArrowFunction(fn)) {
                    if (!ts.isBlock(fn.body)) init = unwrap(fn.body);
                    else if (fn.body.statements.length === 1 && ts.isReturnStatement(fn.body.statements[0])) init = unwrap(fn.body.statements[0].expression);
                }
            }
            if (init && ts.isArrayLiteralExpression(init)) found = { array: init, statement: candidate, name: node.text };
            else found = { unresolved: true };
        }
        return undefined;
    });
    search(scope);
    if (!found) search(sf);
    return found && !found.unresolved ? found : null;
}

function within(node, container) {
    return node.getStart() >= container.getStart() && node.getEnd() <= container.getEnd();
}

/** Finds `const [open, setOpen] = (React.)useState(...)` for `openName` → statement + setter name. */
function findOpenState(scope, openName, sf) {
    let found = null;
    forEachDescendant(scope, (node) => {
        if (found) return false;
        if (!ts.isVariableStatement(node) || node.declarationList.declarations.length !== 1) return undefined;
        const declaration = node.declarationList.declarations[0];
        if (!ts.isArrayBindingPattern(declaration.name) || declaration.name.elements.length !== 2) return undefined;
        const [value, setter] = declaration.name.elements;
        if (!ts.isBindingElement(value) || value.name.getText(sf) !== openName || !ts.isBindingElement(setter)) return undefined;
        const init = declaration.initializer && unwrap(declaration.initializer);
        if (!init || !ts.isCallExpression(init) || !/(^|\.)useState$/.test(init.expression.getText(sf))) return undefined;
        found = { statement: node, setter: setter.name.getText(sf) };
        return undefined;
    });
    return found;
}

/** Identifiers read by an expression. */
function namesIn(expr, sf) {
    const out = [];
    const visit = (node) => {
        if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) out.push(node.text);
        ts.forEachChild(node, visit);
    };
    visit(expr);
    return out;
}

/** Whether a trigger subtitle only names the chosen option (its label keys, or `<items>.find(…).title`). */
function restatesChoice(expr, options, items, scope, sf) {
    const textOf = expr.getText(sf);
    // Every t() call in the subtitle is one of the option labels → it only names the choice.
    const keys = [...textOf.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)].map((match) => match[1]);
    const calls = (textOf.match(/\bt\(/g) ?? []).length;
    if (keys.length > 0 && keys.length === calls && keys.every((key) => options.some((option) => option.titleKey === key))) return true;
    const node = unwrap(expr);
    if ((ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain?.(node)) && node.name.text === 'title' && ts.isIdentifier(node.expression) && items.name) {
        let initializer = null;
        forEachDescendant(scope, (candidate) => {
            if (ts.isVariableDeclaration(candidate) && candidate.name.getText(sf) === node.expression.text && candidate.initializer) initializer = candidate.initializer.getText(sf);
            return undefined;
        });
        return !!initializer && initializer.includes(`${items.name}.find(`);
    }
    return false;
}

for (const rel of listScopeFiles()) {
    if (!runner.selected(rel)) continue;
    const initial = readFileSync(absOf(rel), 'utf8');
    if (!initial.includes('<DropdownMenu')) continue;
    const blocked = isHandMigrated(rel) ? 'hand-migrated page' : isNonPage(rel) ? 'not page content (shell/catalog/menu/picker)' : null;
    runner.processFile(rel, (text) => {
        const sf = parseSource(rel, text);
        const edits = [];
        let converted = 0;
        const cleanupNames = new Set();
        forEachDescendant(sf, (node) => {
            if (!isJsx(node) || tagNameOf(node) !== 'DropdownMenu') return undefined;
            const line = lineOf(sf, node.getStart(sf));
            const trigger = attrExpression(getAttr(node, 'itemTrigger'));
            if (!trigger) return undefined; // a menu, not a row
            const skip = (reason, detail) => runner.skip(rel, line, reason, detail);
            if (blocked) return skip(blocked);
            if (!ts.isJsxSelfClosingElement(node)) return skip('dropdown has children');
            if (!ts.isObjectLiteralExpression(trigger)) return skip('trigger is not a static object');
            const attrs = openingOf(node).attributes.properties;
            if (attrs.some((attr) => ts.isJsxSpreadAttribute(attr))) return skip('dropdown spreads props');
            const extraProps = attrs.map((attr) => attr.name.getText(sf)).filter((name) => !MENU_PROPS.has(name));
            if (extraProps.length) return skip('extra menu behaviour', extraProps.join(', '));
            const extraTrigger = trigger.properties.map((candidate) => candidate.name?.getText(sf) ?? '…').filter((name) => !TRIGGER_PROPS.has(name) && name !== 'icon');
            if (extraTrigger.length) return skip('extra trigger behaviour', extraTrigger.join(', '));
            // Row props carried to the new row as attributes (`testID`, `disabled`, `showDivider`, …).
            const itemProps = prop(trigger, 'itemProps', sf);
            const rowAttributes = [];
            if (itemProps) {
                const value = unwrap(itemProps.initializer);
                if (!ts.isObjectLiteralExpression(value)) return skip('trigger itemProps is not a static object');
                for (const candidate of value.properties) {
                    if (ts.isShorthandPropertyAssignment(candidate)) { rowAttributes.push(`${candidate.name.text}={${candidate.name.text}}`); continue; }
                    if (!ts.isPropertyAssignment(candidate)) return skip('trigger itemProps is not a static object');
                    const name = candidate.name.getText(sf);
                    if (['onPress', 'rightElement', 'accessoryLayout', 'title', 'subtitle'].includes(name)) return skip('trigger itemProps overrides the row control', name);
                    const init = unwrap(candidate.initializer);
                    rowAttributes.push(ts.isStringLiteral(init) ? `${name}=${init.getText(sf)}` : `${name}={${candidate.initializer.getText(sf)}}`);
                }
            }
            const scope = findEnclosingFunction(node) ?? sf;
            const itemsExpr = attrExpression(getAttr(node, 'items'));
            const items = itemsExpr ? resolveItems(itemsExpr, scope, sf) : null;
            if (!items) return skip('dynamic options', itemsExpr ? itemsExpr.getText(sf).slice(0, 60) : 'no items');
            const elements = items.array.elements;
            if (elements.length < 2 || elements.length > 3) return skip(`${elements.length} options (segmented takes 2–3)`);
            const options = [];
            for (const element of elements) {
                if (!ts.isObjectLiteralExpression(element)) return skip('dynamic options', element.getText(sf).slice(0, 60));
                const names = element.properties.map((candidate) => (ts.isPropertyAssignment(candidate) ? candidate.name.getText(sf) : '…'));
                const extra = names.filter((name) => !OPTION_PROPS.has(name));
                if (extra.length) return skip('option has extra behaviour', extra.join(', '));
                const id = prop(element, 'id', sf) && unwrap(prop(element, 'id', sf).initializer);
                const titleKey = prop(element, 'title', sf) && staticTKey(prop(element, 'title', sf).initializer);
                const subtitleProp = prop(element, 'subtitle', sf);
                const subtitleKey = subtitleProp ? staticTKey(subtitleProp.initializer) : null;
                if (!id || !ts.isStringLiteral(id)) return skip('dynamic options', 'non-literal id');
                if (!titleKey) return skip('dynamic options', 'label is not a static t() key');
                if (subtitleProp && !subtitleKey) return skip('dynamic options', 'option description is not a static t() key');
                const label = english[titleKey];
                if (typeof label !== 'string') return skip('dynamic options', `unknown key ${titleKey}`);
                if (label.length > MAX_LABEL) return skip('long option labels', `"${label}"`);
                options.push({ id: id.text, titleKey, subtitleKey });
            }
            const selected = attrExpression(getAttr(node, 'selectedId'));
            const onSelect = attrExpression(getAttr(node, 'onSelect'));
            if (!selected || !onSelect) return skip('dropdown without selectedId/onSelect');
            // Open state: removable only when it serves this menu alone.
            const stateEdits = [];
            const openExpr = attrExpression(getAttr(node, 'open'));
            if (openExpr) {
                if (!ts.isIdentifier(openExpr)) return skip('open state is not a local useState');
                const state = findOpenState(scope, openExpr.text, sf);
                if (!state) return skip('open state is not a local useState');
                for (const ref of references(scope, openExpr.text, sf)) {
                    if (!within(ref, node)) return skip('open state used elsewhere', `${openExpr.text} @${lineOf(sf, ref.getStart(sf))}`);
                }
                for (const ref of references(scope, state.setter, sf)) {
                    if (within(ref, openingOf(node).attributes) && ref.parent && ts.isJsxExpression(ref.parent)) continue; // onOpenChange={setOpen}
                    const call = ref.parent;
                    if (ts.isCallExpression(call) && call.expression === ref && ts.isExpressionStatement(call.parent)
                        && call.arguments.length === 1 && [ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(call.arguments[0].kind)) {
                        stateEdits.push(removalEditForNode(text, call.parent, sf));
                        continue;
                    }
                    if (ts.isArrayLiteralExpression(ref.parent) && ts.isCallExpression(ref.parent.parent)) {
                        const array = ref.parent;
                        const index = array.elements.indexOf(ref);
                        const start = index > 0 ? array.elements[index - 1].getEnd() : ref.getStart(sf);
                        const end = index > 0 ? ref.getEnd() : (array.elements[index + 1] ? array.elements[index + 1].getStart(sf) : ref.getEnd());
                        stateEdits.push({ start, end, text: '' });
                        continue;
                    }
                    return skip('open state used elsewhere', `${state.setter} @${lineOf(sf, ref.getStart(sf))}`);
                }
                stateEdits.push(removalEditForNode(text, state.statement, sf));
            }
            // Options constant: removed when this menu was its only reader.
            if (items.name) cleanupNames.add(items.name);
            // Option descriptions always carry over (the row describes the chosen option). When the
            // dropdown row pinned its own description instead, the two would compete: left for U8.
            const showSelected = prop(trigger, 'showSelectedSubtitle', sf);
            const pinnedSubtitle = showSelected && unwrap(showSelected.initializer).kind === ts.SyntaxKind.FalseKeyword;
            const triggerSubtitle = prop(trigger, 'subtitle', sf);
            if (pinnedSubtitle && triggerSubtitle && options.some((option) => option.subtitleKey)
                && !restatesChoice(triggerSubtitle.initializer, options, items, scope, sf)) {
                return skip('row description and option descriptions compete');
            }
            const keepDescriptions = true;
            const indent = indentAt(text, node.getStart(sf));
            const inner = `${indent}    `;
            const lines = [`<SegmentedChoiceItem`];
            for (const attribute of rowAttributes) lines.push(`${inner}${attribute}`);
            lines.push(`${inner}title={${prop(trigger, 'title', sf).initializer.getText(sf)}}`);
            // A trigger subtitle that only names the chosen option repeats what the segmented control
            // shows, so it is dropped (the craft rule: never two strings saying the same thing).
            const subtitle = prop(trigger, 'subtitle', sf);
            if (subtitle && !restatesChoice(subtitle.initializer, options, items, scope, sf)) lines.push(`${inner}subtitle={${subtitle.initializer.getText(sf)}}`);
            else if (subtitle) cleanupNames.add(...namesIn(subtitle.initializer, sf));
            lines.push(`${inner}options={[`);
            for (const option of options) {
                const description = keepDescriptions && option.subtitleKey ? `, description: t('${option.subtitleKey}')` : '';
                lines.push(`${inner}    { id: '${option.id}', label: t('${option.titleKey}')${description} },`);
            }
            lines.push(`${inner}]}`);
            lines.push(`${inner}value={${selected.getText(sf)}}`);
            const onSelectText = text.slice(onSelect.getStart(sf), onSelect.getEnd());
            lines.push(`${inner}onChange={${onSelectText.split('\n').join('\n')}}`);
            const disabled = getAttr(node, 'disabled');
            if (disabled) lines.push(`${inner}${disabled.getText(sf)}`);
            lines.push(`${indent}/>`);
            // Remove setOpen(false) calls that sit inside the moved onSelect text.
            let replacement = lines.join('\n');
            const insideEdits = stateEdits.filter((edit) => edit.start >= onSelect.getStart(sf) && edit.end <= onSelect.getEnd());
            if (insideEdits.length) {
                const localEdits = insideEdits.map((edit) => ({ ...edit, start: edit.start - onSelect.getStart(sf), end: edit.end - onSelect.getStart(sf) }));
                const newOnSelect = applyEdits(onSelectText, localEdits);
                replacement = replacement.replace(`onChange={${onSelectText}}`, `onChange={${newOnSelect}}`);
            }
            const outside = stateEdits.filter((edit) => !insideEdits.includes(edit) && (edit.end <= node.getStart(sf) || edit.start >= node.getEnd()));
            edits.push(...outside, { start: node.getStart(sf), end: node.getEnd(), text: replacement });
            converted += 1;
            runner.match(rel, line, keepDescriptions && options.some((option) => option.subtitleKey) ? 'dropdown → segmented (chosen option described)' : 'dropdown → segmented', options.map((option) => english[option.titleKey]).join(' | '));
            return undefined;
        });
        if (!converted) return text;
        let next = applyEdits(text, edits);
        next = removeUnusedLocals(next, rel, cleanupNames);
        next = ensureNamedImport(next, rel, 'SegmentedChoiceItem', '@/components/ui/lists/SegmentedChoiceItem');
        next = ensureNamedImport(next, rel, 't', '@/text');
        next = removeImportIfUnused(next, rel, 'DropdownMenu');
        next = removeImportIfUnused(next, rel, 'DropdownMenuItem');
        next = removeImportIfUnused(next, rel, 'Icon');
        next = removeUnusedThemeHook(next, rel);
        return next;
    });
}

runner.finish();

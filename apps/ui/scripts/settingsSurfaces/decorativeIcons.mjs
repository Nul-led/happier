#!/usr/bin/env node
/**
 * Codemod 2 — decorative row icons.
 *
 * Removes a plain `<Icon … />` (from `@/components/ui/icons/Icon`) passed as `icon` to a preference
 * row — `Item`, `SettingRow`, `SegmentedChoiceItem`, and the `itemTrigger.icon` of a `DropdownMenu`
 * row — then drops the `Icon` import and a `const { theme } = useUnistyles()` that the removal left
 * unused.
 *
 * Kept and reported:
 * - anything that is not a plain `Icon` (agent/provider/service/machine/person marks, avatars, brand
 *   marks, wrapped views, helper calls, variables);
 * - a plain `Icon` whose `name` or `color` depends on state, a warning/error glyph, or a status glyph
 *   (check, info, lock…) tinted with a state colour (a status mark, not decoration: U8 recomposes these
 *   into state banners). A decorative glyph merely painted in a state colour is removed;
 * - rows rendered by a `.map()` callback (collection rows: whether their glyph is an identity mark is
 *   decided per collection in U8);
 * - hand-migrated pages, and non-page files (settings shell and rail, catalog, overview navigation,
 *   menus, pickers, popovers, sheets: I1).
 *
 *   node scripts/settingsSurfaces/decorativeIcons.mjs [--write] [--only <path-part>]
 */
import { readFileSync } from 'node:fs';

import {
    absOf,
    applyEdits,
    attrExpression,
    createRunner,
    forEachDescendant,
    getAttr,
    importBindings,
    isHandMigrated,
    isJsx,
    isNonPage,
    lineOf,
    listScopeFiles,
    openingOf,
    parseSource,
    removalEditForAttr,
    removalEditForProperty,
    removeImportIfUnused,
    removeUnusedLocals,
    removeUnusedThemeHook,
    tagNameOf,
    ts,
    unwrap,
} from './lib.mjs';

const ROW_TAGS = new Set(['Item', 'SettingRow', 'SegmentedChoiceItem']);
const ICON_MODULE = '@/components/ui/icons/Icon';
/** Glyphs that announce a state rather than decorate a label. */
const STATUS_GLYPHS = new Set(['warning', 'warning-circle', 'warning-octagon', 'x-circle', 'cloud-slash', 'shield-warning']);
/** Glyphs that announce a state when tinted with a state colour ("Ready ✓", "Connected"). */
const STATUS_TINTABLE_GLYPHS = new Set(['check-circle', 'check', 'x', 'info', 'shield-check', 'cloud-check', 'plugs-connected', 'plugs', 'wifi-slash', 'lock', 'lock-open', 'bell-slash', 'circle-half', 'circle']);
/** Colors that tint a glyph as a state (success/warning/danger/error), not as decoration. */
const STATUS_COLOR = /\.(state|status)\.|warningColor|dangerColor|errorColor/;
/** The overview menu: rows are destinations carrying their catalog glyphs (lab O1, U8 f). */
const OVERVIEW = /^sources\/components\/settings\/Settings[A-Za-z]*\.tsx$/;

const runner = createRunner('decorativeIcons');

function isDynamic(expr) {
    const node = expr && unwrap(expr);
    if (!node) return false;
    return ts.isConditionalExpression(node)
        || (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind));
}

/** Classifies an `icon` value: `plain` (removable), or a reason it is kept. */
function classifyIcon(expr, iconLocalName, sf, viaHelper = null) {
    const node = unwrap(expr);
    if (!node) return { keep: 'empty icon expression' };
    if (!isJsx(node)) {
        if (ts.isConditionalExpression(node)) return { keep: 'conditional icon (state glyph)' };
        if (ts.isCallExpression(node)) {
            const helper = resolveIconHelper(node, iconLocalName, sf);
            if (helper) return classifyIcon(helper.body, iconLocalName, sf, helper.name);
            return { keep: 'icon from a helper call', detail: node.expression.getText(sf) };
        }
        return { keep: 'icon from a variable or expression', detail: node.getText(sf).slice(0, 60) };
    }
    const tag = tagNameOf(node);
    if (tag !== iconLocalName) return { keep: 'not a plain Icon (identity mark or custom element)', detail: tag };
    if (ts.isJsxElement(node)) return { keep: 'Icon with children' };
    const name = attrExpression(getAttr(node, 'name'));
    const color = attrExpression(getAttr(node, 'color'));
    if (isDynamic(name) || isDynamic(color)) return { keep: 'state glyph (name or color depends on state)', detail: node.getText(sf).slice(0, 90) };
    // A computed glyph or a colour held in a local (`iconColor`, `permissionIconColor`) is chosen by
    // state; a decorative glyph has a literal name and a theme/prop colour.
    if (name && !ts.isStringLiteral(name)) return { keep: 'state glyph (name or color depends on state)', detail: node.getText(sf).slice(0, 90) };
    if (color && ts.isIdentifier(color)) return { keep: 'state glyph (name or color depends on state)', detail: node.getText(sf).slice(0, 90) };
    const nameText = name && ts.isStringLiteral(name) ? name.text : '';
    if (STATUS_GLYPHS.has(nameText) || (STATUS_TINTABLE_GLYPHS.has(nameText) && color && STATUS_COLOR.test(color.getText(sf)))) {
        return { keep: 'status glyph (warning/error/success tint: a state, recomposed in U8)', detail: node.getText(sf).slice(0, 90) };
    }
    if (openingOf(node).attributes.properties.some((prop) => ts.isJsxSpreadAttribute(prop))) return { keep: 'Icon with spread props' };
    return { plain: true, viaHelper };
}

/**
 * `renderIcon('sparkle')` where `renderIcon` is a local `(name) => <Icon name={name} … />` (plain or
 * in `useCallback`) and every argument is a string literal: the call renders a plain decorative Icon.
 */
function resolveIconHelper(call, iconLocalName, sf) {
    if (!ts.isIdentifier(call.expression) || !call.arguments.every((arg) => ts.isStringLiteral(arg))) return null;
    const name = call.expression.text;
    let body = null;
    forEachDescendant(sf, (node) => {
        if (body || !ts.isVariableDeclaration(node) || node.name.getText(sf) !== name || !node.initializer) return undefined;
        let init = unwrap(node.initializer);
        if (ts.isCallExpression(init) && /(^|\.)useCallback$/.test(init.expression.getText(sf))) init = unwrap(init.arguments[0]);
        if (!init || !ts.isArrowFunction(init) || ts.isBlock(init.body)) return undefined;
        const returned = unwrap(init.body);
        if (isJsx(returned) && tagNameOf(returned) === iconLocalName) body = returned;
        return undefined;
    });
    return body ? { body, name } : null;
}

function insideMapCallback(node) {
    let current = node.parent;
    while (current) {
        if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isCallExpression(current.parent)) {
            const callee = current.parent.expression;
            if (ts.isPropertyAccessExpression(callee) && ['map', 'flatMap'].includes(callee.name.text)) return true;
        }
        current = current.parent;
    }
    return false;
}

for (const rel of listScopeFiles()) {
    if (!runner.selected(rel)) continue;
    const initial = readFileSync(absOf(rel), 'utf8');
    if (!/\bicon[=:]/.test(initial)) continue;
    const blocked = isHandMigrated(rel)
        ? 'hand-migrated page'
        : OVERVIEW.test(rel)
            ? 'overview navigation (catalog glyphs, U8 f)'
            : isNonPage(rel)
                ? 'not page content (shell/catalog/menu/picker)'
                : null;
    runner.processFile(rel, (text) => {
        const sf = parseSource(rel, text);
        const iconBinding = [...importBindings(sf).entries()].find(([, binding]) => binding.module === ICON_MODULE && binding.imported === 'Icon');
        const iconLocalName = iconBinding ? iconBinding[0] : null;
        const edits = [];
        const helpers = new Set();
        const consider = (host, valueExpr, removal, line, where) => {
            if (blocked) { runner.skip(rel, line, blocked); return; }
            if (!iconLocalName) { runner.skip(rel, line, 'not a plain Icon (identity mark or custom element)', 'no Icon import'); return; }
            const verdict = classifyIcon(valueExpr, iconLocalName, sf);
            if (!verdict.plain) { runner.skip(rel, line, verdict.keep, verdict.detail); return; }
            if (insideMapCallback(host)) { runner.skip(rel, line, 'collection row rendered by .map() (identity decided in U8)', where); return; }
            edits.push(removal);
            if (verdict.viaHelper) helpers.add(verdict.viaHelper);
            runner.match(rel, line, `decorative Icon removed (${where}${verdict.viaHelper ? `, via ${verdict.viaHelper}()` : ''})`);
        };
        forEachDescendant(sf, (node) => {
            if (isJsx(node) && ROW_TAGS.has(tagNameOf(node))) {
                const attr = getAttr(node, 'icon');
                if (attr) consider(node, attrExpression(attr), removalEditForAttr(text, attr, sf), lineOf(sf, attr.getStart(sf)), tagNameOf(node));
            }
            if (isJsx(node) && tagNameOf(node) === 'DropdownMenu') {
                const trigger = attrExpression(getAttr(node, 'itemTrigger'));
                if (trigger && ts.isObjectLiteralExpression(trigger)) {
                    const prop = trigger.properties.find((candidate) => ts.isPropertyAssignment(candidate) && candidate.name.getText(sf) === 'icon');
                    if (prop) consider(node, prop.initializer, removalEditForProperty(text, prop, sf), lineOf(sf, prop.getStart(sf)), 'DropdownMenu itemTrigger');
                }
            }
            return undefined;
        });
        if (edits.length === 0) return text;
        let next = applyEdits(text, edits);
        next = removeUnusedLocals(next, rel, helpers);
        next = removeImportIfUnused(next, rel, iconLocalName);
        next = removeUnusedThemeHook(next, rel);
        return next;
    });
}

runner.finish();

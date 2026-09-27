#!/usr/bin/env node
/**
 * Codemod 6 — target machine chip.
 *
 * A page whose first content under its `SettingsPageHeader` is a full-width
 * `MachineAdministrationTargetSelector` (section or context presentation) moves the selector into the
 * header's `actions` as `presentation="chip"`. Every prop of the selector is kept.
 *
 * Every other selector in the settings scope is reported with the reason it was left alone (no page
 * header, not at the top of the page, nested in a group, header already has actions, …).
 *
 *   node scripts/settingsSurfaces/targetMachineChip.mjs [--write] [--only <path-part>]
 */
import { readFileSync } from 'node:fs';

import {
    absOf,
    applyEdits,
    attrExpression,
    createRunner,
    forEachDescendant,
    getAttr,
    indentAt,
    isHandMigrated,
    isJsx,
    lineOf,
    listScopeFiles,
    openingOf,
    parseSource,
    removalEditForRange,
    tagNameOf,
    ts,
} from './lib.mjs';

const SELECTOR = 'MachineAdministrationTargetSelector';
const runner = createRunner('targetMachineChip');

function significantChildren(element) {
    return element.children.filter((child) => !(ts.isJsxText(child) && /^\s*$/.test(child.text)));
}

/** Re-indents a multi-line snippet so its first line sits at `indent`. */
function reindent(snippet, fromIndent, indent) {
    return snippet.split('\n').map((line, index) => {
        if (index === 0) return `${indent}${line}`;
        return line.startsWith(fromIndent) ? `${indent}${line.slice(fromIndent.length)}` : `${indent}${line.trimStart()}`;
    }).join('\n');
}

for (const rel of listScopeFiles()) {
    if (!runner.selected(rel)) continue;
    const initial = readFileSync(absOf(rel), 'utf8');
    if (!initial.includes(`<${SELECTOR}`)) continue;
    if (isHandMigrated(rel)) {
        runner.skip(rel, 1, 'hand-migrated page');
        continue;
    }
    runner.processFile(rel, (text) => {
        const sf = parseSource(rel, text);
        const edits = [];
        const converted = new Set();
        forEachDescendant(sf, (node) => {
            if (!ts.isJsxElement(node) || tagNameOf(node) !== 'ItemList') return undefined;
            const presentation = attrExpression(getAttr(node, 'presentation'));
            if (!presentation || !ts.isStringLiteral(presentation) || presentation.text !== 'page') return undefined;
            const children = significantChildren(node);
            const header = children[0];
            if (!header || !isJsx(header) || tagNameOf(header) !== 'SettingsPageHeader') return undefined;
            // Only conditional notices (`{cond ? <Notice/> : null}`) and comments may sit between the
            // header and the selector; the selector is still the first fact of the page.
            let index = 1;
            const comments = [];
            while (index < children.length && ts.isJsxExpression(children[index])) {
                const expression = children[index].expression;
                if (!expression) comments.push(children[index]);
                else if (ts.isConditionalExpression(expression) || (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) comments.length = 0;
                else break;
                index += 1;
            }
            const selector = children[index];
            if (!selector || !isJsx(selector) || tagNameOf(selector) !== SELECTOR) return undefined;
            const line = lineOf(sf, selector.getStart(sf));
            converted.add(selector);
            const selectorPresentation = attrExpression(getAttr(selector, 'presentation'));
            if (selectorPresentation && !(ts.isStringLiteral(selectorPresentation) && ['section', 'context'].includes(selectorPresentation.text))) {
                runner.skip(rel, line, 'selector presentation is not section/context', selectorPresentation.getText(sf));
                return undefined;
            }
            if (!ts.isJsxSelfClosingElement(header)) {
                runner.skip(rel, line, 'page header has children');
                return undefined;
            }
            if (getAttr(header, 'actions')) {
                runner.skip(rel, line, 'page header already has actions');
                return undefined;
            }
            // The selector with presentation="chip" (replacing any existing presentation attribute).
            const selectorStart = selector.getStart(sf);
            const selectorIndent = indentAt(text, selectorStart);
            let selectorText = text.slice(selectorStart, selector.getEnd());
            if (selectorPresentation) {
                const attr = getAttr(selector, 'presentation');
                const attrStart = attr.getStart(sf) - selectorStart;
                const attrEnd = attr.getEnd() - selectorStart;
                selectorText = `${selectorText.slice(0, attrStart)}presentation="chip"${selectorText.slice(attrEnd)}`;
            } else if (ts.isJsxSelfClosingElement(selector)) {
                const attrs = openingOf(selector).attributes.properties;
                const last = attrs[attrs.length - 1];
                const multiline = last && sf.getLineAndCharacterOfPosition(last.getStart(sf)).line !== sf.getLineAndCharacterOfPosition(selectorStart).line;
                const insertAt = (last ? last.getEnd() : openingOf(selector).tagName.getEnd()) - selectorStart;
                const addition = multiline ? `\n${indentAt(text, last.getStart(sf))}presentation="chip"` : ' presentation="chip"';
                selectorText = selectorText.slice(0, insertAt) + addition + selectorText.slice(insertAt);
            } else {
                runner.skip(rel, line, 'selector has children');
                return undefined;
            }
            const headerStart = header.getStart(sf);
            const headerIndent = indentAt(text, headerStart);
            const attrIndent = `${headerIndent}    `;
            const headerAttrs = openingOf(header).attributes.properties.map((attr) => `${attrIndent}${text.slice(attr.getStart(sf), attr.getEnd())}`);
            // A JSX comment that introduced the selector moves with it, as a plain comment.
            const movedComments = comments.map((comment) => {
                const raw = text.slice(comment.getStart(sf), comment.getEnd());
                const inner = raw.replace(/^\{\s*/, '').replace(/\s*\}$/, '');
                return reindent(inner, indentAt(text, comment.getStart(sf)), `${attrIndent}    `);
            });
            const actions = `${attrIndent}actions={(\n${[...movedComments, reindent(selectorText, selectorIndent, `${attrIndent}    `)].join('\n')}\n${attrIndent})}`;
            const newHeader = `<SettingsPageHeader\n${[...headerAttrs, actions].join('\n')}\n${headerIndent}/>`;
            edits.push({ start: headerStart, end: header.getEnd(), text: newHeader });
            edits.push(removalEditForRange(text, (comments[0] ?? selector).getStart(sf), selector.getEnd()));
            runner.match(rel, line, 'selector moved into the page header as a chip');
            return undefined;
        });
        // Report every selector left in place.
        forEachDescendant(sf, (node) => {
            if (!isJsx(node) || tagNameOf(node) !== SELECTOR || converted.has(node)) return undefined;
            const presentation = attrExpression(getAttr(node, 'presentation'));
            const value = presentation && ts.isStringLiteral(presentation) ? presentation.text : (presentation ? presentation.getText(sf) : 'section (default)');
            if (value === 'chip') return undefined;
            let parent = node.parent;
            const chain = [];
            while (parent && chain.length < 3) {
                if (isJsx(parent)) chain.push(tagNameOf(parent));
                if (ts.isJsxAttribute(parent)) chain.push(`${parent.name.getText(sf)}=`);
                parent = parent.parent;
            }
            const reason = chain.includes('ItemGroup')
                ? 'selector nested in a group'
                : chain[0] === 'ItemList'
                    ? 'selector not directly under a page header (page not converted or not at the top)'
                    : 'selector outside a page list';
            runner.skip(rel, lineOf(sf, node.getStart(sf)), reason, `presentation=${value}; parents: ${chain.join(' < ')}`);
            return undefined;
        });
        return edits.length ? applyEdits(text, edits) : text;
    });
}

runner.finish();

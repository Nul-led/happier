/**
 * Shared machinery for the configuration-surface codemods (plan
 * `.project/plans/2026-09-23-configuration-surfaces-redesign`, unit U7). Dev tooling, not product code.
 *
 * Every codemod parses with the TypeScript compiler API and rewrites only the byte ranges of the
 * pattern it owns, so unrelated (possibly uncommitted) hunks in the same file are preserved. Each run
 * is a dry run unless `--write` is passed, and always writes a report (matches + skips with reasons)
 * and a patch of exactly its own edits to `--out` (default: `<tmpdir>/settings-surfaces/<codemod>`).
 *
 * Common flags:
 *   --write            apply the edits (default: dry run)
 *   --out <dir>        where the report, pre/post images and patch go
 *   --only <substr>    restrict to files whose repo-relative path contains <substr> (repeatable)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

export { ts };

export const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SOURCES_ROOT = path.join(UI_ROOT, 'sources');
export const SETTINGS_ROUTES_DIR = 'sources/app/(app)/settings';
export const SETTINGS_COMPONENTS_DIR = 'sources/components/settings';
export const SCOPE_DIRS = [SETTINGS_ROUTES_DIR, SETTINGS_COMPONENTS_DIR];

/**
 * Pages migrated by hand in U6 (reference screens). The codemods never touch them; U8 owns any
 * follow-up there.
 */
const HAND_MIGRATED = [
    /^sources\/app\/\(app\)\/settings\/(appearance|session|account)\.tsx$/,
    /^sources\/app\/\(app\)\/settings\/account\/security\.tsx$/,
    /^sources\/app\/\(app\)\/settings\/agents\//,
    /^sources\/components\/settings\/agents\//,
    /^sources\/components\/settings\/account\/(?!AddPhoneSettingsView\.tsx$)/,
    /^sources\/components\/settings\/appearance\/[^/]+$/,
    /^sources\/components\/settings\/session\/(SessionListDensityPreview\.tsx|sessionSettings\.ts)$/,
];

/**
 * Files that are not page content: the settings shell/rail, the page catalog, navigation chrome and
 * pickers, and anything named as a floating surface (I1: menus, pickers, popovers and sheets keep
 * their presentation).
 */
const NON_PAGE = [
    /^sources\/components\/settings\/(shell|catalog|navigation|pickers)\//,
    /(Modal|Picker|Popover|Menu|Sheet|Dialog|Overlay)[A-Za-z]*\.tsx$/,
    /\/_layout\.tsx$/,
];

export function isHandMigrated(rel) {
    return HAND_MIGRATED.some((pattern) => pattern.test(rel));
}

export function isNonPage(rel) {
    return NON_PAGE.some((pattern) => pattern.test(rel));
}

export function relOf(abs) {
    return path.relative(UI_ROOT, abs).split(path.sep).join('/');
}

export function absOf(rel) {
    return path.join(UI_ROOT, rel);
}

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) yield* walk(full);
        else yield full;
    }
}

/** Production `.tsx`/`.ts` files under the settings routes and settings components. */
export function listScopeFiles({ tsxOnly = true } = {}) {
    const files = [];
    for (const dir of SCOPE_DIRS) {
        for (const file of walk(absOf(dir))) {
            const rel = relOf(file);
            if (!(tsxOnly ? /\.tsx$/ : /\.tsx?$/).test(rel)) continue;
            if (/\.(test|spec)\.tsx?$/.test(rel) || /\.d\.ts$/.test(rel)) continue;
            files.push(rel);
        }
    }
    return files.sort();
}

export function isInScope(rel) {
    return SCOPE_DIRS.some((dir) => rel.startsWith(`${dir}/`));
}

export function parseSource(rel, text) {
    const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
}

export function unwrap(expr) {
    let current = expr;
    while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression?.(current) || ts.isNonNullExpression(current))) {
        current = current.expression;
    }
    return current;
}

export function isJsx(node) {
    return !!node && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node));
}

export function openingOf(node) {
    return ts.isJsxElement(node) ? node.openingElement : node;
}

export function tagNameOf(node) {
    return openingOf(node).tagName.getText();
}

export function getAttr(node, name) {
    const opening = openingOf(node);
    return opening.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText() === name) ?? null;
}

export function hasSpreadAttr(node) {
    return openingOf(node).attributes.properties.some((prop) => ts.isJsxSpreadAttribute(prop));
}

/** The expression of `attr={expr}`, or a string literal node for `attr="x"`. */
export function attrExpression(attr) {
    if (!attr || !attr.initializer) return null;
    if (ts.isStringLiteral(attr.initializer)) return attr.initializer;
    if (ts.isJsxExpression(attr.initializer)) return attr.initializer.expression ? unwrap(attr.initializer.expression) : null;
    return null;
}

/** `t('static.key')` with no parameters → `'static.key'`; anything else → null. */
export function staticTKey(expr) {
    const node = unwrap(expr);
    if (!node || !ts.isCallExpression(node)) return null;
    if (!ts.isIdentifier(node.expression) || node.expression.text !== 't') return null;
    if (node.arguments.length !== 1) return null;
    const arg = node.arguments[0];
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
    return null;
}

/** Leading whitespace of the line containing `pos`. */
export function indentAt(text, pos) {
    const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
    const match = /^[ \t]*/.exec(text.slice(lineStart));
    return match ? match[0] : '';
}

export function lineOf(sf, pos) {
    return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

export function forEachDescendant(node, visit) {
    const recurse = (current) => {
        if (visit(current) === false) return;
        ts.forEachChild(current, recurse);
    };
    ts.forEachChild(node, recurse);
}

export function isFunctionLike(node) {
    return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}

/**
 * Applies non-overlapping `{ start, end, text }` edits. Throws on overlap so a codemod can never
 * silently clobber its own output.
 */
export function applyEdits(text, edits) {
    const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
    let out = text;
    let lastStart = Infinity;
    for (const edit of sorted) {
        if (edit.end > lastStart) throw new Error(`overlapping edits at ${edit.start}-${edit.end}`);
        out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
        lastStart = edit.start;
    }
    return out;
}

/** Removes the whole lines spanned by `node` when it sits alone on them, else just its text. */
export function removalEditForNode(text, node, sf) {
    return removalEditForRange(text, node.getStart(sf), node.getEnd());
}

/** Like `removalEditForNode`, for a source range spanning several siblings. */
export function removalEditForRange(text, start, end) {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = text.indexOf('\n', end);
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
    const before = text.slice(lineStart, start);
    const after = text.slice(end, lineEnd);
    if (/^\s*$/.test(before) && /^\s*,?\s*$/.test(after)) {
        let removeEnd = Math.min(text.length, lineEnd + 1);
        // Removing a block that sat between two blank lines would leave a double blank line.
        const previousLineStart = text.lastIndexOf('\n', lineStart - 2) + 1;
        const previousBlank = lineStart > 0 && /^[ \t]*$/.test(text.slice(previousLineStart, lineStart - 1));
        const nextLineEnd = text.indexOf('\n', removeEnd);
        const nextBlank = nextLineEnd !== -1 && /^[ \t]*$/.test(text.slice(removeEnd, nextLineEnd));
        if (previousBlank && nextBlank) removeEnd = nextLineEnd + 1;
        return { start: lineStart, end: removeEnd, text: '' };
    }
    // Inline: take one adjacent whitespace run with it.
    const leading = /\s+$/.exec(before);
    return { start: leading ? start - leading[0].length : start, end, text: '' };
}

/** Removes a JSX attribute including the whitespace that separates it from the previous token. */
export function removalEditForAttr(text, attr, sf) {
    const start = attr.getStart(sf);
    const end = attr.getEnd();
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = text.indexOf('\n', end);
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
    if (/^\s*$/.test(text.slice(lineStart, start)) && /^\s*$/.test(text.slice(end, lineEnd))) {
        return { start: lineStart, end: lineEnd + 1, text: '' };
    }
    const leading = /\s+$/.exec(text.slice(0, start));
    return { start: leading ? start - leading[0].length : start, end, text: '' };
}

/** Removes an object-literal property and its trailing comma. */
export function removalEditForProperty(text, prop, sf) {
    const start = prop.getStart(sf);
    let end = prop.getEnd();
    const rest = text.slice(end);
    const comma = /^\s*,/.exec(rest);
    if (comma) end += comma[0].length;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = text.indexOf('\n', end);
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
    if (/^\s*$/.test(text.slice(lineStart, start)) && /^\s*$/.test(text.slice(end, lineEnd))) {
        return { start: lineStart, end: lineEnd + 1, text: '' };
    }
    const trailingSpace = /^[ \t]*/.exec(text.slice(end))[0];
    return { start, end: end + trailingSpace.length, text: '' };
}

/** Maps local import names to their module specifier and import declaration. */
export function importBindings(sf) {
    const bindings = new Map();
    for (const statement of sf.statements) {
        if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
        const moduleSpec = statement.moduleSpecifier.text;
        const clause = statement.importClause;
        if (clause.name) bindings.set(clause.name.text, { module: moduleSpec, declaration: statement, kind: 'default' });
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            for (const element of clause.namedBindings.elements) {
                bindings.set(element.name.text, {
                    module: moduleSpec,
                    declaration: statement,
                    kind: 'named',
                    imported: (element.propertyName ?? element.name).text,
                    element,
                });
            }
        }
    }
    return bindings;
}

/** Adds `import { name } from 'moduleSpec'` unless `name` is already bound. Returns new text. */
export function ensureNamedImport(text, rel, name, moduleSpec) {
    const sf = parseSource(rel, text);
    const bindings = importBindings(sf);
    if (bindings.has(name)) return text;
    const existing = sf.statements.find((statement) => ts.isImportDeclaration(statement)
        && statement.moduleSpecifier.text === moduleSpec
        && !statement.importClause?.isTypeOnly
        && statement.importClause?.namedBindings
        && ts.isNamedImports(statement.importClause.namedBindings));
    if (existing) {
        const named = existing.importClause.namedBindings;
        const last = named.elements[named.elements.length - 1];
        if (last) {
            return applyEdits(text, [{ start: last.getEnd(), end: last.getEnd(), text: `, ${name}` }]);
        }
    }
    const imports = sf.statements.filter((statement) => ts.isImportDeclaration(statement));
    const line = `import { ${name} } from '${moduleSpec}';\n`;
    if (imports.length === 0) return line + text;
    const lastImport = imports[imports.length - 1];
    const insertAt = text.indexOf('\n', lastImport.getEnd());
    return applyEdits(text, [{ start: insertAt + 1, end: insertAt + 1, text: line }]);
}

/** Identifiers named `name` outside import declarations. */
export function countIdentifierUses(sf, name) {
    let count = 0;
    forEachDescendant(sf, (node) => {
        if (ts.isImportDeclaration(node)) return false;
        if (ts.isIdentifier(node) && node.text === name) count += 1;
        return undefined;
    });
    return count;
}

/** Drops the import of `name` when nothing else in the file refers to it. Returns new text. */
export function removeImportIfUnused(text, rel, name) {
    const sf = parseSource(rel, text);
    if (countIdentifierUses(sf, name) > 0) return text;
    const binding = importBindings(sf).get(name);
    if (!binding) return text;
    const declaration = binding.declaration;
    const clause = declaration.importClause;
    const named = clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : [];
    const remainingNamed = named.filter((element) => element.name.text !== name);
    const keepsDefault = binding.kind !== 'default' && !!clause.name;
    if (remainingNamed.length === 0 && !keepsDefault && !(binding.kind === 'default' && named.length > 0)) {
        return applyEdits(text, [removalEditForNode(text, declaration, sf)]);
    }
    if (binding.kind === 'named') {
        const element = binding.element;
        const index = named.indexOf(element);
        const start = index > 0 ? named[index - 1].getEnd() : element.getStart(sf);
        const end = index > 0 ? element.getEnd() : (named[index + 1] ? named[index + 1].getStart(sf) : element.getEnd());
        return applyEdits(text, [{ start, end, text: '' }]);
    }
    return text;
}

/**
 * When `const { theme } = useUnistyles();` (or `const theme = useUnistyles().theme`) is left unused by
 * an edit, drop it, then drop `useUnistyles` from the imports if nothing else uses it.
 */
export function removeUnusedThemeHook(text, rel) {
    let current = text;
    for (let guard = 0; guard < 20; guard += 1) {
        const sf = parseSource(rel, current);
        let edit = null;
        forEachDescendant(sf, (node) => {
            if (edit) return false;
            if (!ts.isVariableStatement(node)) return undefined;
            const declarations = node.declarationList.declarations;
            if (declarations.length !== 1) return undefined;
            const declaration = declarations[0];
            const init = declaration.initializer && unwrap(declaration.initializer);
            if (!init || !ts.isCallExpression(init) || init.expression.getText(sf) !== 'useUnistyles') return undefined;
            if (!ts.isObjectBindingPattern(declaration.name)) return undefined;
            const elements = declaration.name.elements;
            if (elements.length !== 1 || elements[0].propertyName || elements[0].name.getText(sf) !== 'theme') return undefined;
            const scope = findEnclosingFunction(node) ?? sf;
            let uses = 0;
            forEachDescendant(scope, (inner) => {
                if (ts.isIdentifier(inner) && inner.text === 'theme' && inner !== elements[0].name) {
                    const parent = inner.parent;
                    if (ts.isPropertyAccessExpression(parent) && parent.name === inner) return undefined;
                    if (ts.isPropertyAssignment(parent) && parent.name === inner) return undefined;
                    uses += 1;
                }
                return undefined;
            });
            if (uses === 0) edit = removalEditForNode(current, node, sf);
            return undefined;
        });
        if (!edit) break;
        current = applyEdits(current, [edit]);
    }
    return removeImportIfUnused(current, rel, 'useUnistyles');
}

export function findEnclosingFunction(node) {
    let current = node.parent;
    while (current) {
        if (isFunctionLike(current)) return current;
        current = current.parent;
    }
    return null;
}

/** Resolves an import specifier to a repo-relative source file (`@/` → `sources/`). */
export function resolveModule(fromRel, spec) {
    let base;
    if (spec.startsWith('@/')) base = path.join(SOURCES_ROOT, spec.slice(2));
    else if (spec.startsWith('.')) base = path.join(path.dirname(absOf(fromRel)), spec);
    else return null;
    const candidates = [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')];
    for (const candidate of candidates) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return relOf(candidate);
    }
    return null;
}

/** Imported modules of a file that resolve to source files. */
export function localImports(rel, text) {
    const sf = parseSource(rel, text);
    const out = new Set();
    for (const statement of sf.statements) {
        if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) continue;
            const target = resolveModule(rel, statement.moduleSpecifier.text);
            if (target) out.add(target);
        }
    }
    return out;
}

/**
 * Files rendered under a page-presented `ItemList`: files containing `presentation="page"` plus the
 * settings-scope files they import, transitively. Floating surfaces are excluded (I1).
 */
export function pagePresentedFiles() {
    const scope = listScopeFiles();
    const seeds = scope.filter((rel) => /presentation="page"/.test(readFileSync(absOf(rel), 'utf8')));
    const seen = new Set();
    const queue = [...seeds];
    while (queue.length) {
        const rel = queue.shift();
        if (seen.has(rel)) continue;
        seen.add(rel);
        const text = readFileSync(absOf(rel), 'utf8');
        for (const target of localImports(rel, text)) {
            if (!isInScope(target) || !target.endsWith('.tsx') || isNonPage(target)) continue;
            if (!seen.has(target)) queue.push(target);
        }
    }
    return { seeds: new Set(seeds), files: seen };
}

/** Parses the settings route chrome registry: `[{ name, navigator, titleKey, headerShown }]`. */
export function loadRouteRegistry() {
    const rel = 'sources/components/settings/navigation/settingsRouteRegistry.ts';
    const sf = parseSource(rel, readFileSync(absOf(rel), 'utf8'));
    const out = [];
    forEachDescendant(sf, (node) => {
        if (ts.isVariableDeclaration(node) && node.name.getText(sf) === 'SETTINGS_ROUTE_CHROME_DEFINITIONS') {
            const array = unwrap(node.initializer);
            for (const element of array.elements) {
                if (!ts.isObjectLiteralExpression(element)) continue;
                const entry = {};
                for (const prop of element.properties) {
                    if (!ts.isPropertyAssignment(prop)) continue;
                    const key = prop.name.getText(sf);
                    const value = unwrap(prop.initializer);
                    if (ts.isStringLiteral(value)) entry[key] = value.text;
                    else if (value.kind === ts.SyntaxKind.FalseKeyword) entry[key] = false;
                    else if (value.kind === ts.SyntaxKind.TrueKeyword) entry[key] = true;
                }
                out.push(entry);
            }
            return false;
        }
        return undefined;
    });
    return out;
}

/** Parses the page catalog: `[{ id, route, titleKey, subtitleKey, keywords, keywordsNode }]`. */
export function loadPageCatalog() {
    const routesRel = 'sources/components/settings/catalog/routes.ts';
    const routesSf = parseSource(routesRel, readFileSync(absOf(routesRel), 'utf8'));
    const routes = {};
    forEachDescendant(routesSf, (node) => {
        if (ts.isPropertyAssignment(node) && ts.isStringLiteral(unwrap(node.initializer))) {
            routes[node.name.getText(routesSf)] = unwrap(node.initializer).text;
        }
        return undefined;
    });
    const rel = 'sources/components/settings/catalog/pageCatalog.tsx';
    const text = readFileSync(absOf(rel), 'utf8');
    const sf = parseSource(rel, text);
    const nodes = [];
    forEachDescendant(sf, (node) => {
        if (!ts.isObjectLiteralExpression(node)) return undefined;
        const props = new Map();
        for (const prop of node.properties) {
            if (ts.isPropertyAssignment(prop)) props.set(prop.name.getText(sf), prop);
        }
        const idProp = props.get('id');
        if (!idProp || !ts.isStringLiteral(unwrap(idProp.initializer))) return undefined;
        const entry = { id: unwrap(idProp.initializer).text };
        const route = props.get('route') && unwrap(props.get('route').initializer);
        if (route && ts.isPropertyAccessExpression(route)) entry.route = routes[route.name.getText(sf)] ?? null;
        for (const key of ['titleKey', 'subtitleKey']) {
            const value = props.get(key) && unwrap(props.get(key).initializer);
            if (value && ts.isStringLiteral(value)) entry[key] = value.text;
        }
        const keywords = props.get('keywords');
        if (keywords) {
            entry.keywordsProperty = keywords;
            const array = unwrap(keywords.initializer);
            entry.keywords = ts.isArrayLiteralExpression(array)
                ? array.elements.map((element) => (ts.isStringLiteral(element) ? element.text : null))
                : null;
        }
        nodes.push(entry);
        return undefined;
    });
    return { nodes, sourceFile: sf, text, rel };
}

/** `sources/app/(app)/settings/a/b/index.tsx` → `{ name: 'a/b/index', url: '/settings/a/b' }`. */
export function routeOfFile(rel) {
    const name = rel.slice(`${SETTINGS_ROUTES_DIR}/`.length).replace(/\.tsx$/, '');
    const url = `/settings/${name}`.replace(/\/index$/, '');
    return { name, url };
}

export function routeTitle(registry, name) {
    const first = name.split('/')[0];
    for (const definition of registry) {
        const full = definition.navigator ? `${definition.navigator}/${definition.name}` : definition.name;
        if (full === name) return definition;
    }
    // `agents.tsx`-style section routes are registered without the navigator prefix.
    return registry.find((definition) => !definition.navigator && definition.name === name && first) ?? null;
}

let englishCache = null;
/** Flattened English copy (`{ key: text | null }`), produced by `dumpEnglish.ts` through tsx. */
export function loadEnglish() {
    if (englishCache) return englishCache;
    const out = path.join(os.tmpdir(), `settings-surfaces-en-${process.pid}.json`);
    const tsxBin = [path.join(UI_ROOT, 'node_modules/.bin/tsx'), path.join(UI_ROOT, '../../node_modules/.bin/tsx')].find((candidate) => existsSync(candidate));
    const result = spawnSync(tsxBin, [path.join(UI_ROOT, 'scripts/settingsSurfaces/dumpEnglish.ts'), out], { cwd: UI_ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
    if (result.status !== 0) throw new Error(`dumpEnglish failed: ${result.stderr}`);
    englishCache = JSON.parse(readFileSync(out, 'utf8'));
    rmSync(out, { force: true });
    return englishCache;
}

export function parseArgs(argv = process.argv.slice(2)) {
    const args = { write: false, out: null, only: [] };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--write') args.write = true;
        else if (arg === '--out') args.out = argv[++i];
        else if (arg === '--only') args.only.push(argv[++i]);
    }
    return args;
}

/**
 * Collects per-file results, writes changed files (with `--write`) and the report. A file's
 * transform receives its CURRENT bytes and returns the new text; it is re-run on fresh bytes right
 * before writing, so a concurrent edit between planning and writing is never overwritten.
 */
export function createRunner(name) {
    const args = parseArgs();
    const outDir = args.out ?? path.join(os.tmpdir(), 'settings-surfaces', name);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    const matches = [];
    const skips = [];
    const changed = [];

    const selected = (rel) => args.only.length === 0 || args.only.some((part) => rel.includes(part));

    return {
        args,
        outDir,
        selected,
        match(rel, line, kind, detail) {
            matches.push({ file: rel, line, kind, ...(detail ? { detail } : {}) });
        },
        skip(rel, line, reason, detail) {
            skips.push({ file: rel, line, reason, ...(detail ? { detail } : {}) });
        },
        /** `transform(text) → newText`; records matches/skips itself. */
        processFile(rel, transform) {
            const abs = absOf(rel);
            const before = readFileSync(abs, 'utf8');
            const matchCount = matches.length;
            const skipCount = skips.length;
            const after = transform(before);
            if (after === before) return false;
            if (args.write) {
                const fresh = readFileSync(abs, 'utf8');
                if (fresh !== before) {
                    matches.length = matchCount;
                    skips.length = skipCount;
                    return this.processFile(rel, transform);
                }
                writeFileSync(abs, after);
            }
            const prePath = path.join(outDir, 'pre', rel);
            const postPath = path.join(outDir, 'post', rel);
            mkdirSync(path.dirname(prePath), { recursive: true });
            mkdirSync(path.dirname(postPath), { recursive: true });
            writeFileSync(prePath, before);
            writeFileSync(postPath, after);
            changed.push(rel);
            return true;
        },
        /** Writes a new file (for generated modules). */
        createFile(rel, content) {
            const abs = absOf(rel);
            if (existsSync(abs)) throw new Error(`refusing to overwrite ${rel}`);
            if (args.write) {
                mkdirSync(path.dirname(abs), { recursive: true });
                writeFileSync(abs, content);
            }
            const postPath = path.join(outDir, 'post', rel);
            mkdirSync(path.dirname(postPath), { recursive: true });
            writeFileSync(postPath, content);
            changed.push(rel);
        },
        finish(extra = {}) {
            const patch = [];
            for (const rel of changed) {
                const prePath = path.join(outDir, 'pre', rel);
                const postPath = path.join(outDir, 'post', rel);
                const result = spawnSync('git', ['diff', '--no-index', '--no-color', existsSync(prePath) ? prePath : '/dev/null', postPath], { encoding: 'utf8' });
                patch.push((result.stdout ?? '').split(outDir + '/pre/').join('').split(outDir + '/post/').join(''));
            }
            writeFileSync(path.join(outDir, 'changes.patch'), patch.join('\n'));
            const skipCounts = {};
            for (const entry of skips) skipCounts[entry.reason] = (skipCounts[entry.reason] ?? 0) + 1;
            const matchCounts = {};
            for (const entry of matches) matchCounts[entry.kind] = (matchCounts[entry.kind] ?? 0) + 1;
            const report = {
                codemod: name,
                mode: args.write ? 'write' : 'dry-run',
                filesChanged: changed.length,
                matchCounts,
                skipCounts,
                ...extra,
                changedFiles: changed,
                matches,
                skips,
            };
            writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
            const lines = [
                `# ${name} (${report.mode})`,
                '',
                `Files changed: ${changed.length}`,
                '',
                '## Matches',
                ...Object.entries(matchCounts).map(([kind, count]) => `- ${kind}: ${count}`),
                '',
                '## Skips',
                ...Object.entries(skipCounts).map(([reason, count]) => `- ${reason}: ${count}`),
                '',
                '## Skip detail',
                ...skips.map((entry) => `- ${entry.file}:${entry.line} — ${entry.reason}${entry.detail ? ` (${entry.detail})` : ''}`),
            ];
            writeFileSync(path.join(outDir, 'report.md'), `${lines.join('\n')}\n`);
            console.log(`${name} [${report.mode}] files changed: ${changed.length}`);
            console.log(`  matches: ${JSON.stringify(matchCounts)}`);
            console.log(`  skips:   ${JSON.stringify(skipCounts)}`);
            console.log(`  report:  ${path.join(outDir, 'report.md')}`);
            return report;
        },
    };
}

/** References to `name` in `root`, excluding the declaration name itself. */
export function references(root, name, sf) {
    const out = [];
    forEachDescendant(root, (node) => {
        if (ts.isIdentifier(node) && node.text === name) {
            const parent = node.parent;
            if (ts.isPropertyAccessExpression(parent) && parent.name === node) return undefined;
            if ((ts.isPropertyAssignment(parent) || ts.isBindingElement(parent) || ts.isVariableDeclaration(parent)) && parent.name === node) return undefined;
            out.push(node);
        }
        return undefined;
    });
    return out;
}

/** Deletes `const` declarations among `names` that nothing reads any more (repeats until stable). */
export function removeUnusedLocals(text, rel, names) {
    let current = text;
    for (let changed = true; changed;) {
        changed = false;
        const sf = parseSource(rel, current);
        for (const name of names) {
            let statement = null;
            forEachDescendant(sf, (node) => {
                if (!statement && ts.isVariableStatement(node) && node.declarationList.declarations.length === 1
                    && node.declarationList.declarations[0].name.getText(sf) === name) statement = node;
                return undefined;
            });
            if (!statement) continue;
            const scope = findEnclosingFunction(statement) ?? sf;
            if (references(scope, name, sf).length > 0) continue;
            current = applyEdits(current, [removalEditForNode(current, statement, sf)]);
            changed = true;
            break;
        }
    }
    return current;
}


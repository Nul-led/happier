/**
 * Settings-surface alignment audit (dev tooling, not product code).
 *
 * Loads the running dev web app once per viewport, walks every settings route from
 * `settingsRouteRegistry.ts` plus settings-like root pages, and measures the rendered DOM of the
 * content pane: page title / subtitle / leading mark / back control, section titles and
 * descriptions, sheets, row heights, the gaps between them and the content column. Values that
 * drift from the dominant (mode) value across routes are reported as outliers.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright \
 *   node apps/ui/scripts/settingsSurfaces/alignmentAudit.mjs --label before \
 *     [--routes /settings/account,/plugins] [--viewports 1440,390] [--out <dir>] [--seed-paths <p1,p2>]
 *
 * Env: HAPPIER_AUDIT_BASE_URL (default http://127.0.0.1:19364). Writes `audit-<label>.json` and
 * `audit-<label>.txt` (the outlier table, also printed) to `--out` (default .happier/qa/fidelity/craft-f).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const REGISTRY = path.join(REPO_ROOT, 'apps/ui/sources/components/settings/navigation/settingsRouteRegistry.ts');
const BASE_URL = (process.env.HAPPIER_AUDIT_BASE_URL ?? 'http://127.0.0.1:19364').replace(/\/$/, '');
const STORAGE_STATE = path.join(REPO_ROOT, process.env.HAPPIER_AUDIT_STORAGE_STATE ?? '.happier/qa/pilot-browser-state.json');
const VIEWPORT_HEIGHTS = { 1440: 1000, 390: 844 };
const FIRST_LOAD_TIMEOUT_MS = 300_000;
const SETTLE_QUIET_MS = 1_500;
const SETTLE_CAP_MS = 25_000;
const TOLERANCE_PX = 1;

function parseArgs(argv) {
    const args = { label: 'run', viewports: [1440, 390], out: path.join(REPO_ROOT, '.happier/qa/fidelity/craft-f'), routes: null, seedPaths: [] };
    for (let i = 0; i < argv.length; i += 1) {
        const [flag, value] = [argv[i], argv[i + 1]];
        if (flag === '--label') args.label = value;
        else if (flag === '--viewports') args.viewports = value.split(',').map(Number);
        else if (flag === '--out') args.out = path.resolve(value);
        else if (flag === '--routes') args.routes = value.split(',').map((r) => r.trim()).filter(Boolean);
        else if (flag === '--seed-paths') args.seedPaths = value.split(',').map((r) => r.trim()).filter(Boolean);
        else continue;
        i += 1;
    }
    return args;
}

// ---------------------------------------------------------------------------------------------
// Route inventory
// ---------------------------------------------------------------------------------------------

/** Registry entries as URL patterns (`index` is its directory); `headerShown: false` entries are skipped. */
function readRegistryPatterns() {
    const source = readFileSync(REGISTRY, 'utf8');
    const block = source.slice(source.indexOf('SETTINGS_ROUTE_CHROME_DEFINITIONS'), source.indexOf('] as const'));
    const patterns = [];
    const skipped = [];
    for (const match of block.matchAll(/\{([^{}]*\bname:\s*'[^']+'[^{}]*)\}/g)) {
        const body = match[1];
        const name = /\bname:\s*'([^']+)'/.exec(body)[1];
        const navigator = /\bnavigator:\s*'([^']+)'/.exec(body)?.[1];
        const segments = `${navigator ? `${navigator}/` : ''}${name}`.split('/');
        if (segments.at(-1) === 'index') segments.pop();
        const pattern = ['settings', ...segments].join('/');
        if (/\bheaderShown:\s*false/.test(body)) skipped.push({ route: `/${pattern}`, reason: 'headerShown: false' });
        else if (!patterns.includes(pattern)) patterns.push(pattern);
    }
    return { patterns, skipped };
}

/** Settings-like root-stack pages; `bind` names the settings pattern prefix whose discovered id fills `:id`. */
const EXTRA_ROUTES = [
    { pattern: 'plugins' },
    { pattern: 'plugins/listing' },
    { pattern: 'server' },
    { pattern: 'account' },
    { pattern: 'machine/:id', bind: 'machine' },
    { pattern: 'machine/:id/installables', bind: 'machine' },
    { pattern: 'session/:id/info', bind: 'session' },
    { pattern: 'session/:id/details', bind: 'session' },
    { pattern: 'session/:id/sharing', bind: 'session' },
];

/**
 * Ids seen in rendered links, keyed by the pattern prefix that ends at the param
 * (`settings/teams/[serverId]/[teamId]` → teamId), so `[id]` under machines never fills `[id]` under prompts.
 */
function bindHref(bindings, patterns, href) {
    const segments = href.replace(/^\//, '').split(/[?#]/)[0].replace(/\/$/, '').split('/');
    const machine = /^machine\/([^/]+)/.exec(segments.join('/'));
    if (machine) bindings.machine ??= machine[1];
    const session = /^session\/([^/]+)/.exec(segments.join('/'));
    if (session && !['recent', 'archived'].includes(session[1])) bindings.session ??= session[1];
    for (const pattern of patterns) {
        const parts = pattern.split('/');
        if (parts.length !== segments.length) continue;
        const staticOk = parts.every((part, i) => part.startsWith('[') || part === segments[i]);
        if (!staticOk) continue;
        parts.forEach((part, i) => {
            if (!part.startsWith('[')) return;
            const key = parts.slice(0, i + 1).join('/');
            bindings[key] ??= segments[i];
            if (key === 'settings/machines/[id]') bindings.machine ??= segments[i];
        });
    }
}

function resolvePattern(bindings, pattern) {
    const parts = pattern.split('/');
    const out = [];
    for (let i = 0; i < parts.length; i += 1) {
        if (!parts[i].startsWith('[')) { out.push(parts[i]); continue; }
        const value = bindings[parts.slice(0, i + 1).join('/')];
        if (!value) return null;
        out.push(value);
    }
    return `/${out.join('/')}`;
}

// ---------------------------------------------------------------------------------------------
// In-page measurement (runs in the browser)
// ---------------------------------------------------------------------------------------------

function measurePage() {
    const vw = window.innerWidth;
    const r = (n) => Math.round(n * 10) / 10;
    const rectOf = (el) => el.getBoundingClientRect();
    const hiddenByAncestor = (el) => !!el.closest('[aria-hidden="true"], [inert]');
    const visible = (el) => {
        const rect = rectOf(el);
        if (rect.width < 1 || rect.height < 1 || rect.right <= 0 || rect.left >= vw) return false;
        if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        return !hiddenByAncestor(el);
    };
    const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const cs = (el) => getComputedStyle(el);
    const px = (v) => parseFloat(v) || 0;

    // The content pane: right of the settings rail / app sidebar when one is docked at the left edge.
    let paneLeft = 0;
    for (const sel of ['[data-testid="settings-shell.sidebarPane"]', '[data-testid="sidebar-view"]']) {
        for (const el of document.querySelectorAll(sel)) {
            const rect = rectOf(el);
            if (visible(el) && rect.left <= 10 && rect.right < vw * 0.6) paneLeft = Math.max(paneLeft, rect.right);
        }
    }
    const inPane = (el) => rectOf(el).left >= paneLeft - 1;

    // Only the focused screen: when stacked screens overlap, an element whose on-screen centre is
    // covered by another screen does not belong to the page. Elements below the fold are kept.
    const onTop = (el) => {
        const rect = rectOf(el);
        const x = Math.min(vw - 1, Math.max(0, rect.left + Math.min(rect.width / 2, 8)));
        const y = rect.top + Math.min(rect.height / 2, 8);
        if (y < 0 || y >= window.innerHeight) return true;
        const hit = document.elementFromPoint(x, y);
        return !hit || el.contains(hit) || hit.contains(el);
    };
    const candidates = (selector) => [...document.querySelectorAll(selector)].filter((el) => visible(el) && inPane(el) && onTop(el));

    const columnOf = (el) => {
        for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
            const maxWidth = cs(node).maxWidth;
            if (maxWidth !== 'none' && maxWidth !== '100%') {
                const rect = rectOf(node);
                return { left: r(rect.left), width: r(rect.width), maxWidth };
            }
        }
        return null;
    };
    const box = (el, kind) => {
        const rect = rectOf(el);
        const column = columnOf(el);
        return {
            kind,
            text: (el.textContent ?? '').trim().slice(0, 60),
            left: r(rect.left),
            relLeft: column ? r(rect.left - column.left) : null,
            top: r(rect.top + window.scrollY),
            bottom: r(rect.bottom + window.scrollY),
            width: r(rect.width),
            height: r(rect.height),
            column,
        };
    };

    // Text leaves: elements carrying their own text node.
    const textLeaves = candidates('div, span, a, p, h1, h2, h3, h4, label').filter(hasOwnText);
    const textBelow = (anchor, maxGap, exclude) => {
        const a = rectOf(anchor);
        return textLeaves
            .filter((el) => !exclude.has(el) && !anchor.contains(el) && !el.contains(anchor))
            .map((el) => ({ el, rect: rectOf(el) }))
            .filter(({ rect }) => rect.top >= a.bottom - 2 && rect.top <= a.bottom + maxGap && rect.left < a.left + 60 && rect.right > a.left - 20)
            .sort((x, y) => x.rect.top - y.rect.top || x.rect.left - y.rect.left)[0]?.el ?? null;
    };

    // Headings (react-native-web renders accessibilityRole="header" as role="heading").
    const headings = candidates('[role="heading"]').map((el) => {
        const style = cs(el);
        return { el, fontSize: px(style.fontSize), lineHeight: px(style.lineHeight), weight: Number(style.fontWeight) || 400 };
    });
    const pageTitles = headings.filter((h) => h.fontSize >= 20).sort((a, b) => rectOf(a.el).top - rectOf(b.el).top);
    const navTitles = headings.filter((h) => h.fontSize >= 16 && h.fontSize < 20 && rectOf(h.el).top < 80);
    const sectionTitles = headings.filter((h) => h.fontSize >= 13 && h.fontSize < 16 && h.weight >= 600);
    const otherHeadings = headings.filter((h) => !pageTitles.includes(h) && !navTitles.includes(h) && !sectionTitles.includes(h));

    const used = new Set(headings.map((h) => h.el));
    const result = { paneLeft: r(paneLeft), title: null, subtitle: null, leading: null, back: null, navTitle: null, sections: [], sheets: [], otherCards: [], otherHeadings: [], emptyStates: [], gaps: {}, rows: [] };

    const titleHeading = pageTitles[0];
    if (titleHeading) {
        const titleEl = titleHeading.el;
        result.title = { ...box(titleEl, 'page-title'), fontSize: titleHeading.fontSize, lineHeight: titleHeading.lineHeight, owner: titleHeading.fontSize === 22 && titleHeading.lineHeight === 28 };
        const subtitleEl = textBelow(titleEl, 40, used);
        if (subtitleEl) {
            used.add(subtitleEl);
            result.subtitle = { ...box(subtitleEl, 'page-subtitle'), fontSize: px(cs(subtitleEl).fontSize) };
            result.gaps.titleToSubtitle = r(rectOf(subtitleEl).top - rectOf(titleEl).bottom);
        }
        const t = rectOf(titleEl);
        const backEl = candidates('[role="button"][aria-label], button[aria-label]').find((el) => /^back$/i.test(el.getAttribute('aria-label') ?? ''));
        if (backEl) {
            const b = rectOf(backEl);
            const column = result.title.column;
            result.back = { ...box(backEl, 'back'), onTitleRow: Math.abs((b.top + b.bottom) / 2 - (t.top + t.bottom) / 2) < 20, insideColumn: column ? b.left >= column.left - 1 && b.right <= column.left + column.width + 1 : null };
        }
        // Leading mark: a text-free square-ish block left of the title within its row.
        const lead = candidates('div, img, svg').filter((el) => {
            const m = rectOf(el);
            if (m.width < 20 || m.width > 96 || m.height < 20 || m.height > 96 || Math.abs(m.width - m.height) > 8) return false;
            if (m.right > t.left + 1 || m.left < t.left - 140) return false;
            const cy = (m.top + m.bottom) / 2;
            if (cy < t.top - 10 || cy > t.bottom + 30) return false;
            if (backEl && (backEl.contains(el) || el.contains(backEl))) return false;
            return !(el.textContent ?? '').trim();
        }).sort((a, b) => rectOf(b).width - rectOf(a).width)[0];
        if (lead) result.leading = box(lead, 'leading-mark');
    } else if (navTitles[0]) {
        result.navTitle = box(navTitles[0].el, 'nav-header-title');
    }

    // Sheets: owner = 14px radius with a hairline border; other rounded bordered/tinted blocks are hand-rolled cards.
    const blocks = candidates('div').filter((el) => {
        const style = cs(el);
        const radius = px(style.borderTopLeftRadius);
        if (radius < 8) return false;
        const rect = rectOf(el);
        if (rect.height < 56 || rect.width < 200) return false;
        const border = px(style.borderTopWidth) > 0 && px(style.borderTopWidth) <= 1.5;
        const tinted = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
        return border || tinted;
    });
    const outermost = blocks.filter((el) => !blocks.some((other) => other !== el && other.contains(el)));
    for (const el of outermost) {
        const style = cs(el);
        const radius = px(style.borderTopLeftRadius);
        const owner = radius === 14 && px(style.borderTopWidth) > 0;
        const entry = { ...box(el, owner ? 'sheet' : 'other-card'), radius, background: style.backgroundColor };
        if (owner) result.sheets.push(entry);
        else result.otherCards.push(entry);
        if (!owner) continue;
        // Rows: children of the first element below the sheet that has more than one visible child.
        let container = el;
        for (let depth = 0; depth < 4; depth += 1) {
            const kids = [...container.children].filter(visible);
            if (kids.length !== 1) break;
            container = kids[0];
        }
        for (const row of [...container.children].filter(visible)) {
            const rect = rectOf(row);
            if (rect.height <= 2) continue;
            const leaves = textLeaves.filter((leaf) => row.contains(leaf));
            if (!leaves.length) continue;
            const minLeft = Math.min(...leaves.map((leaf) => rectOf(leaf).left));
            const lines = leaves
                .filter((leaf) => rectOf(leaf).left <= minLeft + 4)
                .reduce((sum, leaf) => sum + Math.max(1, Math.round(rectOf(leaf).height / (px(cs(leaf).lineHeight) || rectOf(leaf).height))), 0);
            result.rows.push({ sheetTop: entry.top, text: (leaves[0].textContent ?? '').trim().slice(0, 40), height: r(rect.height), lines, single: lines === 1 });
        }
    }
    result.sheets.sort((a, b) => a.top - b.top);

    for (const heading of sectionTitles) {
        const entry = { ...box(heading.el, 'section-title'), fontSize: heading.fontSize, owner: (heading.fontSize === 14 || heading.fontSize === 15) && heading.lineHeight === 20 };
        const descEl = textBelow(heading.el, 24, used);
        if (descEl) {
            // A section description sits between the title and its sheet, never inside a sheet.
            const d = box(descEl, 'section-description');
            if (!result.sheets.some((s) => d.top >= s.top && d.bottom <= s.bottom)) {
                used.add(descEl);
                entry.description = d;
                entry.titleToDescription = r(d.top - entry.bottom);
            }
        }
        const after = entry.description?.bottom ?? entry.bottom;
        const nextSheet = result.sheets.find((s) => s.top >= after - 1);
        if (nextSheet) entry.toSheet = r(nextSheet.top - after);
        const prevSheet = [...result.sheets].reverse().find((s) => s.bottom <= entry.top + 1);
        if (prevSheet) entry.gapFromPrevSheet = r(entry.top - prevSheet.bottom);
        result.sections.push(entry);
    }
    result.sections.sort((a, b) => a.top - b.top);
    result.otherHeadings = otherHeadings.map((h) => ({ ...box(h.el, 'other-heading'), fontSize: h.fontSize, weight: h.weight }));

    // Untitled sheet → sheet gaps (no section title between them).
    result.gaps.untitledSheetGaps = [];
    for (let i = 1; i < result.sheets.length; i += 1) {
        const prev = result.sheets[i - 1];
        const next = result.sheets[i];
        if (!result.sections.some((s) => s.top >= prev.bottom - 1 && s.bottom <= next.top + 1)) result.gaps.untitledSheetGaps.push(r(next.top - prev.bottom));
    }
    const header = result.subtitle ?? result.title;
    const firstBlock = [result.sections[0], result.sheets[0]].filter(Boolean).sort((a, b) => a.top - b.top)[0];
    if (header && firstBlock) result.gaps.headerToFirstBlock = r(firstBlock.top - header.bottom);

    // Empty-state copy.
    result.emptyStates = textLeaves
        .filter((el) => /^(no\b.*\byet\b|nothing\b|no [a-z ]+ (found|configured|available|added))/i.test((el.textContent ?? '').trim()))
        .map((el) => box(el, 'empty-state'));

    const columns = [result.title, ...result.sections, ...result.sheets].map((b) => b?.column).filter(Boolean);
    result.column = columns[0] ?? null;
    result.columns = [...new Set(columns.map((c) => `${c.left}|${c.width}|${c.maxWidth}`))];
    result.textSignature = `${location.pathname}|${(document.body.innerText ?? '').length}|${headings.map((h) => h.el.textContent).join('/')}`;
    return result;
}

// ---------------------------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------------------------

async function settle(page) {
    const start = Date.now();
    let last = '';
    let stableSince = Date.now();
    while (Date.now() - start < SETTLE_CAP_MS) {
        await page.waitForTimeout(250);
        const state = await page.evaluate(() => {
            const shown = (el) => el.getBoundingClientRect().width > 0 && (!el.checkVisibility || el.checkVisibility());
            const loading = [...document.querySelectorAll('[data-testid$="-loading"], [data-testid$="-loading-spinner"], [role="progressbar"]')].filter(shown).length;
            return { loading, sig: `${location.pathname}|${document.getElementsByTagName('*').length}|${(document.body.innerText ?? '').length}` };
        }).catch(() => ({ loading: 1, sig: String(Math.random()) }));
        const key = `${state.loading}|${state.sig}`;
        if (key !== last) { last = key; stableSince = Date.now(); continue; }
        if (state.loading === 0 && Date.now() - stableSince >= SETTLE_QUIET_MS) return { settledMs: Date.now() - start, capped: false };
    }
    return { settledMs: Date.now() - start, capped: true };
}

async function navigate(page, route, previousSignature) {
    const started = Date.now();
    let method = 'client';
    await page.evaluate((target) => {
        window.history.pushState({}, '', target);
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }, route);
    let settled = await settle(page);
    const check = await page.evaluate(() => ({ path: location.pathname, sig: `${location.pathname}|${(document.body.innerText ?? '').length}` }));
    const rendered = check.path === route && check.sig !== previousSignature;
    if (!rendered && check.path === route) {
        method = 'goto';
        await page.goto(BASE_URL + route, { waitUntil: 'domcontentloaded', timeout: FIRST_LOAD_TIMEOUT_MS });
        settled = await settle(page);
    }
    const finalPath = await page.evaluate(() => location.pathname);
    return { method, ms: Date.now() - started, ...settled, finalPath };
}

async function collectHrefs(page) {
    return page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => h && h.startsWith('/')));
}

// ---------------------------------------------------------------------------------------------
// Outliers
// ---------------------------------------------------------------------------------------------

function mode(values) {
    const counts = new Map();
    for (const v of values) if (v !== null && v !== undefined) counts.set(Math.round(v), (counts.get(Math.round(v)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
}

function computeOutliers(results) {
    const outliers = [];
    const add = (entry, what, value, expected) => outliers.push({ route: entry.route, viewport: entry.viewport, what, value, expected });
    for (const viewport of [...new Set(results.map((e) => e.viewport))]) {
        const measured = results.filter((e) => e.viewport === viewport && e.m);
        const settings = measured.filter((e) => e.group === 'settings');
        const all = (pick) => settings.flatMap((e) => pick(e.m)).filter((v) => typeof v === 'number');
        const modes = {
            titleLeft: mode(all((m) => [m.title?.left])),
            titleRel: mode(all((m) => [m.title?.relLeft])),
            subtitleLeft: mode(all((m) => [m.subtitle?.left])),
            sectionLeft: mode(all((m) => m.sections.map((s) => s.left))),
            sectionRel: mode(all((m) => m.sections.map((s) => s.relLeft))),
            sectionDescLeft: mode(all((m) => m.sections.map((s) => s.description?.left))),
            sheetLeft: mode(all((m) => m.sheets.map((s) => s.left))),
            sheetRel: mode(all((m) => m.sheets.map((s) => s.relLeft))),
            sectionGap: mode(all((m) => m.sections.map((s) => s.gapFromPrevSheet))),
            sectionToSheet: mode(all((m) => m.sections.map((s) => s.toSheet))),
            headerToFirstBlock: mode(all((m) => [m.gaps.headerToFirstBlock])),
            singleRow: mode(all((m) => m.rows.filter((row) => row.single).map((row) => row.height))),
            columnWidth: mode(all((m) => [m.column?.width])),
        };
        const off = (value, expected) => typeof value === 'number' && expected !== null && Math.abs(value - expected) > TOLERANCE_PX;
        for (const e of measured) {
            const m = e.m;
            // Settings routes share one pane, so absolute x is what a route switch shows; other pages compare within their column.
            const abs = e.group === 'settings';
            const left = (b, absMode, relMode, what) => {
                if (!b) return;
                if (abs ? off(b.left, absMode) : off(b.relLeft, relMode)) add(e, `${what} ${abs ? 'left' : 'relLeft'} ("${b.text}")`, abs ? b.left : b.relLeft, abs ? absMode : relMode);
            };
            e.modes = modes;
            if (!m.title) add(e, m.navTitle ? `no in-page title (nav header "${m.navTitle.text}")` : 'no page title detected', null, 'page title');
            else if (!m.title.owner) add(e, `title not PageHeader typography (${m.title.fontSize}/${m.title.lineHeight})`, m.title.fontSize, '22/28');
            left(m.title, modes.titleLeft, modes.titleRel, 'title');
            left(m.subtitle, modes.subtitleLeft ?? modes.titleLeft, modes.titleRel, 'subtitle');
            for (const s of m.sections) {
                left(s, modes.sectionLeft, modes.sectionRel, 'section title');
                if (s.description) left(s.description, modes.sectionDescLeft, modes.sectionRel, 'section description');
                if (!s.owner) add(e, `section title not ItemGroup typography ("${s.text}")`, s.fontSize, '14/20');
                if (off(s.gapFromPrevSheet, modes.sectionGap)) add(e, `section gap before "${s.text}"`, s.gapFromPrevSheet, modes.sectionGap);
                if (off(s.toSheet, modes.sectionToSheet)) add(e, `section→sheet gap "${s.text}"`, s.toSheet, modes.sectionToSheet);
            }
            for (const s of m.sheets) left(s, modes.sheetLeft, modes.sheetRel, 'sheet');
            if (m.title && m.sections[0] && Math.abs(m.title.left - m.sections[0].left) > TOLERANCE_PX) add(e, 'title vs first section title (same page)', m.title.left, m.sections[0].left);
            if (m.title && m.subtitle && Math.abs(m.title.left - m.subtitle.left) > TOLERANCE_PX) add(e, 'title vs subtitle (same page)', m.subtitle.left, m.title.left);
            if (m.back && !m.back.onTitleRow) add(e, 'back control not on title row', m.back.left, 'title row');
            if (m.back && m.back.insideColumn === false) add(e, 'back control outside content column', m.back.left, m.title?.column?.left ?? null);
            if (off(m.gaps.headerToFirstBlock, modes.headerToFirstBlock)) add(e, 'header→first section gap', m.gaps.headerToFirstBlock, modes.headerToFirstBlock);
            const tall = m.rows.filter((row) => row.single && modes.singleRow !== null && row.height > modes.singleRow + TOLERANCE_PX);
            for (const row of tall) add(e, `single-line row taller ("${row.text}")`, row.height, modes.singleRow);
            for (const card of m.otherCards) add(e, `hand-rolled card radius ${card.radius}px`, card.left, modes.sheetLeft);
            for (const h of m.otherHeadings) add(e, `hand-rolled heading ${h.fontSize}px/${h.weight} ("${h.text}")`, h.left, modes.sectionLeft);
            for (const empty of m.emptyStates) add(e, `empty state ("${empty.text}")`, empty.left, modes.sectionLeft);
            if (abs && off(m.column?.width, modes.columnWidth)) add(e, 'content column width', m.column.width, modes.columnWidth);
        }
    }
    return outliers;
}

function classOf(what) {
    return what.replace(/\s*\(.*$/, '').replace(/ before ".*$| ".*$/, '').replace(/\d+px\/\d+/, 'N').replace(/radius \d+(\.\d+)?px/, 'radius').trim();
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const runStarted = Date.now();
    mkdirSync(args.out, { recursive: true });
    const { patterns, skipped: registrySkipped } = readRegistryPatterns();
    const skipped = [...registrySkipped];
    const bindings = {};
    for (const seed of args.seedPaths) bindHref(bindings, patterns, seed);

    const browser = await chromium.launch();
    const results = [];
    const timings = {};
    try {
        for (const width of args.viewports) {
            const viewportStarted = Date.now();
            const context = await browser.newContext({ storageState: STORAGE_STATE, viewport: { width, height: VIEWPORT_HEIGHTS[width] ?? 900 }, colorScheme: 'light' });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
            const firstLoadStarted = Date.now();
            // The dev bundle can be slow after a restart or under load: one retry before giving up on
            // this viewport (recorded, and the other viewports still run).
            let loaded = false;
            for (let attempt = 0; attempt < 2 && !loaded; attempt += 1) {
                try {
                    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded', timeout: FIRST_LOAD_TIMEOUT_MS });
                    await page.waitForSelector('[role="heading"]', { timeout: FIRST_LOAD_TIMEOUT_MS });
                    loaded = true;
                } catch (error) {
                    process.stderr.write(`[${width}] first load attempt ${attempt + 1} failed: ${String(error).slice(0, 120)}\n`);
                }
            }
            if (!loaded) {
                timings[`firstLoadFailed@${width}`] = Date.now() - firstLoadStarted;
                await context.close();
                continue;
            }
            await settle(page);
            timings[`firstLoad@${width}`] = Date.now() - firstLoadStarted;
            for (const href of await collectHrefs(page)) bindHref(bindings, patterns, href);

            const queue = args.routes
                ? args.routes.map((route) => ({ route, group: route.startsWith('/settings') ? 'settings' : 'extra' }))
                : [
                    ...patterns.filter((p) => !p.includes('[')).map((p) => ({ route: `/${p}`, group: 'settings' })),
                    ...patterns.filter((p) => p.includes('[')).map((p) => ({ pattern: p, group: 'settings' })),
                    ...EXTRA_ROUTES.map((extra) => ({ extra, group: 'extra' })),
                ];
            let previousSignature = '';
            // Routes that bounced to the app root while the bundle was still warming get one more try.
            const retried = new Set();
            const work = [...queue];
            for (let index = 0; index < work.length; index += 1) {
                const item = work[index];
                let route = item.route;
                if (item.pattern) route = resolvePattern(bindings, item.pattern);
                if (item.extra) route = item.extra.bind ? (bindings[item.extra.bind] ? `/${item.extra.pattern.replace(':id', bindings[item.extra.bind])}` : null) : `/${item.extra.pattern}`;
                const label = item.pattern ? `/${item.pattern}` : item.extra ? `/${item.extra.pattern}` : route;
                if (!route) {
                    if (width === args.viewports[0]) skipped.push({ route: label, reason: 'no id discovered on this account' });
                    continue;
                }
                const entry = { route, pattern: label, group: item.group, viewport: width };
                try {
                    const nav = await navigate(page, route, previousSignature);
                    entry.nav = nav;
                    for (const href of await collectHrefs(page)) bindHref(bindings, patterns, href);
                    const blank = (await page.evaluate(() => (document.body.innerText ?? '').trim().length)) < 40;
                    const bounced = nav.finalPath.replace(/\/$/, '') !== route && (nav.finalPath === '/' || nav.finalPath === '');
                    if ((bounced || blank) && !retried.has(route)) {
                        retried.add(route);
                        work.push({ ...item, route });
                        process.stderr.write(`[${width}] ${route} ${blank ? 'blank page' : 'bounced to /'} — retrying at the end\n`);
                        continue;
                    }
                    if (nav.finalPath.replace(/\/$/, '') !== route) {
                        entry.redirectedTo = nav.finalPath;
                        if (width === args.viewports[0]) skipped.push({ route, reason: `redirects to ${nav.finalPath}` });
                    } else {
                        entry.m = await page.evaluate(measurePage);
                        previousSignature = `${route}|${await page.evaluate(() => (document.body.innerText ?? '').length)}`;
                        if (/unmatched route|this screen doesn't exist/i.test(await page.evaluate(() => document.body.innerText ?? ''))) entry.unmatched = true;
                    }
                } catch (error) {
                    entry.error = String(error).slice(0, 300);
                }
                results.push(entry);
                process.stderr.write(`[${width}] ${route} ${entry.nav?.method ?? ''} ${entry.nav?.ms ?? ''}ms${entry.nav?.capped ? ' (settle capped)' : ''}${entry.redirectedTo ? ` → ${entry.redirectedTo}` : ''}${entry.error ? ` ERROR ${entry.error}` : ''}\n`);
            }
            timings[`viewport@${width}`] = Date.now() - viewportStarted;
            timings[`pageErrors@${width}`] = errors.length;
            await context.close();
        }
    } finally {
        await browser.close();
    }

    const outliers = computeOutliers(results);
    const durationMs = Date.now() - runStarted;
    const measured = results.filter((e) => e.m);
    const summary = {
        label: args.label,
        baseUrl: BASE_URL,
        startedAt: new Date(runStarted).toISOString(),
        durationMs,
        timings,
        routesMeasured: new Set(measured.map((e) => e.route)).size,
        measurements: measured.length,
        clientNavigations: measured.filter((e) => e.nav?.method === 'client').length,
        gotoFallbacks: measured.filter((e) => e.nav?.method === 'goto').length,
        settleCapped: measured.filter((e) => e.nav?.capped).map((e) => `${e.route}@${e.viewport}`),
        unmatched: results.filter((e) => e.unmatched).map((e) => `${e.route}@${e.viewport}`),
        errors: results.filter((e) => e.error).map((e) => ({ route: e.route, viewport: e.viewport, error: e.error })),
        skipped,
        bindings,
        outlierClasses: Object.entries(outliers.reduce((acc, o) => {
            const key = `${o.viewport} ${classOf(o.what)}`;
            acc[key] ??= new Set();
            acc[key].add(o.route);
            return acc;
        }, {})).map(([key, routes]) => ({ class: key, routes: routes.size })).sort((a, b) => b.routes - a.routes),
    };
    writeFileSync(path.join(args.out, `audit-${args.label}.json`), `${JSON.stringify({ summary, outliers, results }, null, 2)}\n`);

    const lines = [
        `# Alignment audit "${args.label}" — ${summary.routesMeasured} routes, ${summary.measurements} measurements, ${Math.round(durationMs / 1000)}s`,
        '',
        '## Outlier classes (routes affected)',
        ...summary.outlierClasses.map((c) => `- ${c.class}: ${c.routes}`),
        '',
        '## Outliers',
        '| route | viewport | what | value | expected |',
        '|---|---|---|---|---|',
        ...outliers.map((o) => `| ${o.route} | ${o.viewport} | ${o.what.replace(/\|/g, '/')} | ${o.value ?? '—'} | ${o.expected ?? '—'} |`),
        '',
        `Skipped: ${skipped.map((s) => `${s.route} (${s.reason})`).join('; ') || 'none'}`,
    ];
    writeFileSync(path.join(args.out, `audit-${args.label}.txt`), `${lines.join('\n')}\n`);
    process.stdout.write(`${lines.join('\n')}\n`);
}

await main();

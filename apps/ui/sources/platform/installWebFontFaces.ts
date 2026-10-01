import { Asset } from 'expo-asset';

import type { DefaultFontWeight } from '@/constants/Typography';

const WEB_FONT_STYLE_ID = 'happier-web-font-faces';

function escapeCssString(value: string): string {
    // Enough for our controlled font family names; avoid pulling in a heavier CSS escaping dependency.
    return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function resolveFontUri(fontModule: unknown): string | null {
    if (!fontModule) return null;

    if (typeof fontModule === 'string' || typeof fontModule === 'number') {
        return Asset.fromModule(fontModule).uri;
    }

    if (
        typeof fontModule === 'object'
        && 'uri' in fontModule
        && typeof (fontModule as { uri?: unknown }).uri === 'string'
    ) {
        return (fontModule as { uri: string }).uri;
    }

    return null;
}

function createFontFaceSource(uri: string): string {
    const lower = uri.toLowerCase();
    const format =
        lower.endsWith('.woff2') ? 'woff2'
        : lower.endsWith('.woff') ? 'woff'
        : lower.endsWith('.otf') ? 'opentype'
        : lower.endsWith('.ttf') ? 'truetype'
        : null;
    return format ? `url("${uri}") format("${format}")` : `url("${uri}")`;
}

function createFontFaceRule(fontFamily: string, uri: string): string {
    return `@font-face{font-family:"${escapeCssString(fontFamily)}";src:${createFontFaceSource(uri)};font-display:swap;}`;
}

export async function installWebFontFaces(fontMap: Readonly<Record<string, unknown>>): Promise<void> {
    if (typeof document === 'undefined') return;
    if (typeof document.getElementById !== 'function') return;
    if (typeof document.createElement !== 'function') return;
    if (!document.head) return;

    const rules: string[] = [];
    const fontFamilies: string[] = [];
    for (const [fontFamily, fontModule] of Object.entries(fontMap)) {
        try {
            const uri = resolveFontUri(fontModule);
            if (!uri) continue;

            rules.push(createFontFaceRule(fontFamily, uri));
            fontFamilies.push(fontFamily);
        } catch {
            // A single unavailable asset is a definitive failure for that face; load the others.
        }
    }

    if (rules.length === 0) return;

    try {
        if (!document.getElementById(WEB_FONT_STYLE_ID)) {
            const style = document.createElement('style');
            style.id = WEB_FONT_STYLE_ID;
            style.textContent = rules.join('\n');
            document.head.appendChild(style);
        }
    } catch {
        // Font injection is best-effort and must not block app startup after a definitive failure.
        return;
    }

    try {
        const fontFaceSet = document.fonts;
        if (!fontFaceSet || typeof fontFaceSet.load !== 'function') return;

        await Promise.allSettled(
            fontFamilies.map(async (fontFamily) => {
                await fontFaceSet.load(`1em "${escapeCssString(fontFamily)}"`);
            }),
        );
    } catch {
        // A missing or malformed FontFaceSet must not brick startup.
    }
}

/** The one runtime face (an embed's font file); it lives beside the bundled faces and replaces itself. */
export const RUNTIME_WEB_FONT_STYLE_ID = 'happier-runtime-web-font-faces';

type RuntimeFaceWeight = DefaultFontWeight;

/**
 * One alias family per default-family weight, each declaring the weight it stands for. A variable
 * font file renders each alias at its declared weight (the descriptor clamps the used weight); a
 * single-weight file renders its own weight everywhere.
 */
const RUNTIME_FACE_DESCRIPTORS: Readonly<Record<RuntimeFaceWeight, Readonly<{ weight: number; style: 'normal' | 'italic' }>>> = {
    regular: { weight: 400, style: 'normal' },
    italic: { weight: 400, style: 'italic' },
    medium: { weight: 500, style: 'normal' },
    semiBold: { weight: 600, style: 'normal' },
    bold: { weight: 600, style: 'normal' },
};

export function runtimeWebFontFaceFamily(weight: RuntimeFaceWeight): string {
    return `happier-runtime-default-${weight}`;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A font file (woff2/woff) over https, or over http on loopback in development. Never a stylesheet. */
export function isRuntimeWebFontFileUrl(value: string): boolean {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    const development = typeof __DEV__ !== 'undefined' && __DEV__ === true;
    const secure = url.protocol === 'https:' || (development && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
    return secure && /\.woff2?$/i.test(url.pathname);
}

export type RuntimeWebFontFaceResult = Readonly<{ status: 'loaded' | 'failed' | 'refused' | 'cleared' }>;

/** The face installed last and its load, so a repeated request for the same file is a no-op. */
let runtimeFaceLoad: Readonly<{ url: string; result: Promise<RuntimeWebFontFaceResult> }> | null = null;

function removeRuntimeFaceIfCurrent(url: string | null): void {
    const style = document.getElementById(RUNTIME_WEB_FONT_STYLE_ID);
    if (style && (url === null || style.getAttribute('data-url') === url)) style.remove();
}

/**
 * Installs (or replaces, or clears) the runtime font face. A refused URL or a file that does not load
 * leaves no face behind, so text falls back through the family list to the Happier family.
 */
export async function installRuntimeWebFontFace(input: Readonly<{ url: string | null }>): Promise<RuntimeWebFontFaceResult> {
    if (typeof document === 'undefined' || !document.head) return { status: input.url ? 'failed' : 'cleared' };
    if (input.url === null) {
        removeRuntimeFaceIfCurrent(null);
        return { status: 'cleared' };
    }
    if (!isRuntimeWebFontFileUrl(input.url)) {
        removeRuntimeFaceIfCurrent(null);
        return { status: 'refused' };
    }

    const url = input.url;
    // A live preview re-sends its whole style on every edit: an installed (or loading) face for the
    // same file is left alone rather than rewritten and reloaded.
    const installed = document.getElementById(RUNTIME_WEB_FONT_STYLE_ID);
    if (runtimeFaceLoad?.url === url && installed?.getAttribute('data-url') === url) return await runtimeFaceLoad.result;
    const result = loadRuntimeWebFontFace(url);
    runtimeFaceLoad = { url, result };
    return await result;
}

async function loadRuntimeWebFontFace(url: string): Promise<RuntimeWebFontFaceResult> {
    const parsed = new URL(url);
    // The normalized href percent-encodes quotes, so the value cannot leave the CSS string.
    const src = createFontFaceSource(`${parsed.origin}${parsed.pathname}${parsed.search}`);
    const rules = (Object.keys(RUNTIME_FACE_DESCRIPTORS) as RuntimeFaceWeight[]).map((weight) => {
        const descriptor = RUNTIME_FACE_DESCRIPTORS[weight];
        return `@font-face{font-family:"${runtimeWebFontFaceFamily(weight)}";src:${src};font-weight:${descriptor.weight};font-style:${descriptor.style};font-display:swap;}`;
    });
    let style = document.getElementById(RUNTIME_WEB_FONT_STYLE_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = RUNTIME_WEB_FONT_STYLE_ID;
        document.head.appendChild(style);
    }
    style.setAttribute('data-url', url);
    style.textContent = rules.join('\n');

    let loaded = false;
    try {
        const faces = await document.fonts?.load?.(`1em "${runtimeWebFontFaceFamily('regular')}"`);
        loaded = Array.isArray(faces) && faces.length > 0;
    } catch {
        loaded = false;
    }
    if (loaded) return { status: 'loaded' };
    // A later call may have replaced this face while it loaded; only remove our own.
    removeRuntimeFaceIfCurrent(url);
    return { status: 'failed' };
}

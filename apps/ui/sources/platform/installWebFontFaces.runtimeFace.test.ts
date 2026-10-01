// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-asset', () => ({ Asset: { fromModule: (module: unknown) => ({ uri: String(module) }) } }));

import {
    RUNTIME_WEB_FONT_STYLE_ID,
    installRuntimeWebFontFace,
    isRuntimeWebFontFileUrl,
} from './installWebFontFaces';

type FontLoad = (font: string) => Promise<unknown[]>;

function installFontFaceSet(load: FontLoad) {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
}

function runtimeRules(): string {
    return document.getElementById(RUNTIME_WEB_FONT_STYLE_ID)?.textContent ?? '';
}

describe('runtime web font face', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
    });

    afterEach(() => {
        Reflect.deleteProperty(document, 'fonts');
    });

    it('accepts only https font files and refuses stylesheet URLs', () => {
        expect(isRuntimeWebFontFileUrl('https://fonts.acme.dev/inter.woff2')).toBe(true);
        expect(isRuntimeWebFontFileUrl('https://fonts.acme.dev/inter.woff?v=3')).toBe(true);
        expect(isRuntimeWebFontFileUrl('https://fonts.googleapis.com/css2?family=Inter')).toBe(false);
        expect(isRuntimeWebFontFileUrl('https://fonts.acme.dev/inter.css')).toBe(false);
        expect(isRuntimeWebFontFileUrl('http://fonts.acme.dev/inter.woff2')).toBe(false);
        expect(isRuntimeWebFontFileUrl('javascript:alert(1)//.woff2')).toBe(false);
    });

    it('refuses a stylesheet URL without installing anything', async () => {
        installFontFaceSet(async () => []);

        const result = await installRuntimeWebFontFace({ url: 'https://fonts.googleapis.com/css2?family=Inter' });

        expect(result).toEqual({ status: 'refused' });
        expect(runtimeRules()).toBe('');
    });

    it('installs weighted faces for a font file and replaces the previous runtime face', async () => {
        installFontFaceSet(async () => [{}]);

        const first = await installRuntimeWebFontFace({ url: 'https://fonts.acme.dev/first.woff2' });
        expect(first.status).toBe('loaded');
        expect(runtimeRules()).toContain('https://fonts.acme.dev/first.woff2');
        expect(runtimeRules()).toContain('font-weight:600');

        const second = await installRuntimeWebFontFace({ url: 'https://fonts.acme.dev/second.woff2' });
        expect(second.status).toBe('loaded');
        expect(runtimeRules()).toContain('https://fonts.acme.dev/second.woff2');
        expect(runtimeRules()).not.toContain('first.woff2');
        expect(document.querySelectorAll(`#${RUNTIME_WEB_FONT_STYLE_ID}`)).toHaveLength(1);
    });

    it('leaves an installed face alone when the same font file is requested again', async () => {
        // A live preview re-sends its whole style on every edit; the face must not be rewritten or
        // reloaded for an unchanged font file (plan 04 §6.2: no repaint or font reload per keystroke).
        const load = vi.fn<FontLoad>(async () => [{}]);
        installFontFaceSet(load);
        await installRuntimeWebFontFace({ url: 'https://fonts.acme.dev/inter.woff2' });
        const style = document.getElementById(RUNTIME_WEB_FONT_STYLE_ID);
        const observer = new MutationObserver(() => undefined);
        observer.observe(style!, { childList: true, characterData: true, subtree: true, attributes: true });

        const again = await installRuntimeWebFontFace({ url: 'https://fonts.acme.dev/inter.woff2' });

        expect(again).toEqual({ status: 'loaded' });
        expect(observer.takeRecords()).toHaveLength(0);
        expect(load).toHaveBeenCalledTimes(1);
        observer.disconnect();
    });

    it('removes its faces and reports failure when the font file does not load', async () => {
        installFontFaceSet(async () => []);

        const result = await installRuntimeWebFontFace({ url: 'https://fonts.acme.dev/missing.woff2' });

        expect(result).toEqual({ status: 'failed' });
        expect(runtimeRules()).toBe('');
    });

    it('clears the runtime face when no font file is requested', async () => {
        installFontFaceSet(async () => [{}]);
        await installRuntimeWebFontFace({ url: 'https://fonts.acme.dev/first.woff2' });

        const result = await installRuntimeWebFontFace({ url: null });

        expect(result).toEqual({ status: 'cleared' });
        expect(runtimeRules()).toBe('');
    });
});

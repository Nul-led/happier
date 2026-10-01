import { describe, expect, it } from 'vitest';

describe('browser address normalization', () => {
    it('normalizes absolute URLs, localhost addresses, domain-like input, and configured search terms', async () => {
        const mod = await import('./address').catch(() => null);

        expect(mod).not.toBeNull();
        if (!mod) return;

        expect(mod.normalizeBrowserAddressInput('https://example.com/app')).toEqual({
            ok: true,
            url: 'https://example.com/app',
        });
        expect(mod.normalizeBrowserAddressInput('localhost:5173')).toEqual({
            ok: true,
            url: 'http://localhost:5173/',
        });
        expect(mod.normalizeBrowserAddressInput('example.com/docs')).toEqual({
            ok: true,
            url: 'https://example.com/docs',
        });
        expect(mod.normalizeBrowserAddressInput('find happier docs', {
            searchUrlTemplate: 'https://search.example/?q={query}',
        })).toEqual({
            ok: true,
            url: 'https://search.example/?q=find%20happier%20docs',
        });
    });

    it('searches with the default engine when the host configures none, so a typed query never dead-ends (H-UX F-16)', async () => {
        const mod = await import('./address');

        expect(mod.normalizeBrowserAddressInput('find happier docs')).toEqual({
            ok: true,
            url: 'https://duckduckgo.com/?q=find%20happier%20docs',
        });
    });
});

describe('formatBrowserDisplayUrl', () => {
    it('trims scheme, leading www, and trailing slash for a clean blurred display', async () => {
        const { formatBrowserDisplayUrl } = await import('./address');

        expect(formatBrowserDisplayUrl('https://example.com/')).toBe('example.com');
        expect(formatBrowserDisplayUrl('https://www.example.com')).toBe('example.com');
        expect(formatBrowserDisplayUrl('http://www.example.com/')).toBe('example.com');
    });

    it('keeps the path, query, and fragment while trimming the scheme', async () => {
        const { formatBrowserDisplayUrl } = await import('./address');

        expect(formatBrowserDisplayUrl('https://example.com/docs/guide?tab=1#intro'))
            .toBe('example.com/docs/guide?tab=1#intro');
        // A trailing slash on a non-root path is preserved (it is meaningful).
        expect(formatBrowserDisplayUrl('https://example.com/docs/')).toBe('example.com/docs/');
    });

    it('keeps localhost addresses readable including the port', async () => {
        const { formatBrowserDisplayUrl } = await import('./address');

        expect(formatBrowserDisplayUrl('http://localhost:3000')).toBe('localhost:3000');
        expect(formatBrowserDisplayUrl('http://localhost:5173/dashboard'))
            .toBe('localhost:5173/dashboard');
    });

    it('returns an empty string for null and falls back to the raw value for non-http input', async () => {
        const { formatBrowserDisplayUrl } = await import('./address');

        expect(formatBrowserDisplayUrl(null)).toBe('');
        expect(formatBrowserDisplayUrl('')).toBe('');
        expect(formatBrowserDisplayUrl('not a url')).toBe('not a url');
        expect(formatBrowserDisplayUrl('about:blank')).toBe('about:blank');
    });
});

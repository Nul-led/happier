import { afterEach, describe, expect, it, vi } from 'vitest';

import { isWebMobileHost, isWebMobileLikeQrScannerHost } from './webMobileHeuristics';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('isWebMobileLikeQrScannerHost', () => {
    it('treats touch-enabled fine-pointer desktops as not mobile-like', () => {
        vi.stubGlobal('navigator', { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' } as any);
        vi.stubGlobal('window', {
            matchMedia: (query: string) => ({ matches: query.includes('pointer: fine') }),
        } as any);

        expect(isWebMobileLikeQrScannerHost({ width: 360, height: 800 })).toBe(false);
    });
});

describe('isWebMobileHost', () => {
    it.each([
        { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 5 },
        { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 5 },
        { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', maxTouchPoints: 0 },
        { userAgent: 'Mozilla/5.0 (X11; CrOS aarch64 16093.0.0)', maxTouchPoints: 5 },
    ])('keeps a desktop computer eligible despite a coarse primary pointer: %j', (navigatorFixture) => {
        vi.stubGlobal('navigator', navigatorFixture);
        vi.stubGlobal('window', {
            matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' || query === '(hover: none)' }),
        });

        expect(isWebMobileHost()).toBe(false);
    });

    it.each([
        { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36' },
        { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
        { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15', maxTouchPoints: 5 },
        { userAgentData: { mobile: true }, userAgent: 'Mozilla/5.0 (Windows NT 10.0)' },
    ])('keeps phone and tablet hosts excluded: %j', (navigatorFixture) => {
        vi.stubGlobal('navigator', navigatorFixture);
        vi.stubGlobal('window', {
            matchMedia: (query: string) => ({ matches: query === '(pointer: fine)' || query === '(hover: hover)' }),
        });

        expect(isWebMobileHost()).toBe(true);
    });

    it('uses the coarse-pointer fallback when host identity is unavailable', () => {
        vi.stubGlobal('navigator', { maxTouchPoints: 2 });
        vi.stubGlobal('window', {
            matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' }),
        });

        expect(isWebMobileHost()).toBe(true);
    });
});

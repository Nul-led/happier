import { describe, expect, it } from 'vitest';

import { buildPublicShareApplicationUrl } from './publicShareApplicationUrl';

describe('buildPublicShareApplicationUrl', () => {
    it('routes a public capability to the exact shareable Home through the existing web bootstrap', () => {
        expect(buildPublicShareApplicationUrl({
            applicationBaseUrl: 'https://app.happier.dev/',
            token: 'public-token',
            serverUrl: 'https://home.example.test/',
        })).toBe('https://app.happier.dev/share/public-token?server=https%3A%2F%2Fhome.example.test');
    });

    it('keeps the released link shape when no publicly routable Home URL is available', () => {
        expect(buildPublicShareApplicationUrl({
            applicationBaseUrl: 'https://app.happier.dev',
            token: 'public-token',
            serverUrl: 'http://127.0.0.1:3005',
        })).toBe('https://app.happier.dev/share/public-token');
    });
});

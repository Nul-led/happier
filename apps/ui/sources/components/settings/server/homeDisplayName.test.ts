import { describe, expect, it, vi } from 'vitest';

import type { ServerProfile } from '@/sync/domains/server/serverProfiles';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

function profile(overrides: Partial<ServerProfile>): ServerProfile {
    return {
        id: 'home-a',
        name: '127.0.0.1:53288',
        serverUrl: 'http://127.0.0.1:53288',
        createdAt: 0,
        updatedAt: 0,
        lastUsedAt: 0,
        ...overrides,
    };
}

describe('resolveHomeDisplayName', () => {
    it('names a Home by the name it was given', async () => {
        const { resolveHomeDisplayName } = await import('./homeDisplayName');
        expect(resolveHomeDisplayName(profile({ name: 'Studio' }))).toBe('Studio');
    });

    it('does not present the address a profile was named after as a Home name', async () => {
        const { resolveHomeDisplayName } = await import('./homeDisplayName');
        expect(resolveHomeDisplayName(profile({}))).toBeNull();
        expect(resolveHomeDisplayName(profile({ name: 'http://127.0.0.1:53288' }))).toBeNull();
        expect(resolveHomeDisplayName(profile({
            name: 'home.example.test',
            serverUrl: 'https://home.example.test/',
        }))).toBeNull();
    });

    it('treats a stored name that is only an address as no name, even after the Home moved', async () => {
        const { resolveHomeDisplayName, resolveHomeDisplayLabel } = await import('./homeDisplayName');
        const moved = { serverUrl: 'http://192.168.5.15:53288' };
        for (const name of [
            '127.0.0.1:53288',
            '127.0.0.1',
            '[::1]:8443',
            'fe80::1',
            'https://old.example.com/home',
            'devbox.internal',
            'leeroy-mbp.tailfce179.ts.net:8443',
            'localhost',
            'devbox:8443',
        ]) {
            expect(resolveHomeDisplayName(profile({ name, ...moved })), name).toBeNull();
            expect(resolveHomeDisplayLabel(profile({ name, ...moved }), 'home-a'), name)
                .toBe('server.homeOnHost(host=192.168.5.15:53288)');
        }
        // Words stay names, including single words and names with version dots.
        for (const name of ['Studio', 'devbox', 'Lab v2.1', 'Work Home']) {
            expect(resolveHomeDisplayName(profile({ name, ...moved })), name).toBe(name);
        }
    });

    it('calls an unnamed Personal Home by its product name', async () => {
        const { resolveHomeDisplayName } = await import('./homeDisplayName');
        expect(resolveHomeDisplayName(profile({ personalHomeBootstrapCompleted: true })))
            .toBe('personalHome.settings.defaultHomeLabel');
        expect(resolveHomeDisplayName(profile({ name: 'Laptop', personalHomeBootstrapCompleted: true })))
            .toBe('Laptop');
    });

    it('has no name for a missing profile', async () => {
        const { resolveHomeDisplayName } = await import('./homeDisplayName');
        expect(resolveHomeDisplayName(null)).toBeNull();
    });
});

describe('resolveHomeDisplayLabel', () => {
    it('shows a named Home by its name', async () => {
        const { resolveHomeDisplayLabel } = await import('./homeDisplayName');
        expect(resolveHomeDisplayLabel(profile({ name: 'Studio' }), 'home-a')).toBe('Studio');
        expect(resolveHomeDisplayLabel(profile({ personalHomeBootstrapCompleted: true }), 'home-a'))
            .toBe('personalHome.settings.defaultHomeLabel');
    });

    it('names an unnamed Home in a sentence with its host as the qualifier, never the raw address', async () => {
        const { resolveHomeDisplayLabel } = await import('./homeDisplayName');
        expect(resolveHomeDisplayLabel(profile({}), 'home-a')).toBe('server.homeOnHost(host=127.0.0.1:53288)');
        expect(resolveHomeDisplayLabel(profile({
            name: 'devbox.internal',
            serverUrl: 'https://devbox.internal/',
        }), 'home-a')).toBe('server.homeOnHost(host=devbox.internal)');
    });

    it('falls back to the id only when there is no address to qualify the Home', async () => {
        const { resolveHomeDisplayLabel } = await import('./homeDisplayName');
        expect(resolveHomeDisplayLabel(null, 'home-a')).toBe('home-a');
    });
});

describe('resolveHomeMarkSource', () => {
    it('draws an unnamed Home’s mark from its host only when the host starts with a letter', async () => {
        const { resolveHomeMarkSource } = await import('./homeDisplayName');
        expect(resolveHomeMarkSource(profile({ name: 'devbox.internal', serverUrl: 'https://devbox.internal' }), 'home-a')).toBe('devbox.internal');
        expect(resolveHomeMarkSource(profile({}), 'home-a')).toBe('server.homeOnHost(host=127.0.0.1:53288)');
        expect(resolveHomeMarkSource(profile({ name: 'Studio' }), 'home-a')).toBe('Studio');
    });
});

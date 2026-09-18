import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('auth providers registry (fallback)', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns null for blank provider ids', async () => {
        const { getAuthProvider } = await import('./registry');
        expect(getAuthProvider('')).toBeNull();
        expect(getAuthProvider('   ')).toBeNull();
    });

    it('maps the full current descriptor presentation onto unknown providers', async () => {
        const { getAuthProvider } = await import('./registry');
        const okta = getAuthProvider('okta', {
            displayName: 'Acme Okta',
            badgeIconName: 'shield-outline',
            connectButtonColor: '#123456',
            supportsProfileBadge: true,
        });

        expect(okta).toBeTruthy();
        expect(okta?.id).toBe('okta');
        expect(okta?.displayName).toBe('Acme Okta');
        expect(okta?.badgeIconName).toBe('shield-outline');
        expect(okta?.connectButtonColor).toBe('#123456');
        expect(okta?.supportsProfileBadge).toBe(true);
    });

    it('keeps dynamic providers badge-free when the descriptor has no presentation metadata', async () => {
        const { getAuthProvider } = await import('./registry');
        const provider = getAuthProvider('okta', { displayName: 'Acme Okta' });

        expect(provider?.displayName).toBe('Acme Okta');
        expect(provider?.badgeIconName).toBeUndefined();
        expect(provider?.connectButtonColor).toBeUndefined();
        expect(provider?.supportsProfileBadge).toBe(false);
    });

    it('does not cache dynamic presentation across endpoint observations', async () => {
        const { getAuthProvider } = await import('./registry');

        const first = getAuthProvider('OKTA', { displayName: 'First', badgeIconName: 'one' });
        const second = getAuthProvider('okta', { displayName: 'Second', badgeIconName: 'two' });
        expect(first).not.toBe(second);
        expect(first?.displayName).toBe('First');
        expect(first?.badgeIconName).toBe('one');
        expect(second?.displayName).toBe('Second');
        expect(second?.badgeIconName).toBe('two');
    });

    it('keeps the built-in contribution when a descriptor matches a built-in id', async () => {
        const { authProviderRegistry, getAuthProvider } = await import('./registry');
        const builtIn = authProviderRegistry[0];
        expect(builtIn?.id).toBe('github');

        const resolved = getAuthProvider('GitHub', {
            displayName: 'Impostor',
            badgeIconName: 'impostor',
            connectButtonColor: '#000000',
            supportsProfileBadge: false,
        });
        expect(resolved).toBe(builtIn);
    });

    it('falls back to capitalized provider id when UI metadata is missing', async () => {
        const { getAuthProvider } = await import('./registry');
        const provider = getAuthProvider('customsso');
        expect(provider?.displayName).toBe('Customsso');
    });
});

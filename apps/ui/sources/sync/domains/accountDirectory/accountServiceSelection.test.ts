import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAccountDirectoryServiceKey } from './accountDirectorySession';

const selectedEndpoint = vi.hoisted(() => ({
    current: {
        url: 'https://api.happier.dev',
        displayName: 'Happier Cloud',
        source: 'default' as const,
    },
}));
const persistedEndpoint = vi.hoisted(() => ({ current: null as null | typeof selectedEndpoint.current }));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getAccountServiceEndpointSnapshot: () => persistedEndpoint.current,
    resolveSelectedAccountServiceEndpoint: () => selectedEndpoint.current,
}));

import { isSelectedAccountServiceKey } from './accountServiceSelection';

describe('isSelectedAccountServiceKey', () => {
    beforeEach(() => {
        persistedEndpoint.current = null;
        selectedEndpoint.current = {
            url: 'https://api.happier.dev',
            displayName: 'Happier Cloud',
            source: 'default',
        };
    });

    it('keeps a fresh-device continuation for the canonical default selection', () => {
        const capturedDefault = createAccountDirectoryServiceKey({
            endpoint: 'https://api.happier.dev',
            serverIdentityId: null,
        });

        expect(persistedEndpoint.current).toBeNull();
        expect(isSelectedAccountServiceKey(capturedDefault)).toBe(true);
    });

    it('rejects the captured default after the canonical selection is replaced', () => {
        const capturedDefault = createAccountDirectoryServiceKey({
            endpoint: 'https://api.happier.dev',
            serverIdentityId: null,
        });
        selectedEndpoint.current = {
            url: 'https://accounts.example.test',
            displayName: 'Other Account Service',
            source: 'user',
        };

        expect(isSelectedAccountServiceKey(capturedDefault)).toBe(false);
    });
});

import { describe, expect, it, vi } from 'vitest';

import type { ServerProfile } from '@/sync/domains/server/serverProfiles';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

const SERVICE_URL = 'http://192.168.5.15:53288';

function home(overrides: Partial<ServerProfile>): ServerProfile {
    return { id: 'home-a', name: '', serverUrl: SERVICE_URL, createdAt: 0, updatedAt: 0, lastUsedAt: 0, ...overrides };
}

describe('resolveAccountServiceDisplayName', () => {
    it('keeps a real saved name', async () => {
        const { resolveAccountServiceDisplayName } = await import('./accountServiceDisplayName');
        expect(resolveAccountServiceDisplayName({ url: SERVICE_URL, savedName: 'Team Cloud', profiles: [] })).toBe('Team Cloud');
    });

    it('treats a saved name that is only an address as no name, even when it is another address', async () => {
        const { resolveAccountServiceDisplayName } = await import('./accountServiceDisplayName');
        for (const savedName of ['127.0.0.1:53288', 'http://127.0.0.1:53288', '192.168.5.15:53288', 'old.example.com']) {
            expect(resolveAccountServiceDisplayName({ url: SERVICE_URL, savedName, profiles: [] }), savedName).toBeNull();
        }
    });

    it('does not name the service after its Home when that Home’s stored name is only an address', async () => {
        const { resolveAccountServiceDisplayName } = await import('./accountServiceDisplayName');
        const profiles = [home({ name: '127.0.0.1:53288' })];
        expect(resolveAccountServiceDisplayName({ url: SERVICE_URL, savedName: '127.0.0.1:53288', profiles })).toBeNull();
        expect(resolveAccountServiceDisplayName({
            url: SERVICE_URL,
            savedName: '127.0.0.1:53288',
            profiles,
            activeServerId: 'home-a',
        })).toBe('settingsAccount.thisHomeTitle');
    });
});

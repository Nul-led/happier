import { afterEach, describe, expect, it, vi } from 'vitest';

import { storage } from '@/sync/domains/state/storage';

// The Home inventory and the row-only transport are the seams an off-list
// acquisition reaches; the transport stand-in hydrates the shared row cache the
// way the real row-only read does, while the acquisition is awaited.
const { listServerProfiles, fetchSessionListQueryPageForHome } = vi.hoisted(() => ({
    listServerProfiles: vi.fn(),
    fetchSessionListQueryPageForHome: vi.fn(),
}));
vi.mock('@/sync/domains/server/serverProfiles', async (importActual) => ({
    ...await importActual<typeof import('@/sync/domains/server/serverProfiles')>(),
    listServerProfiles,
}));
vi.mock('@/sync/domains/session/listing/sessionListQueryRuntime', async (importActual) => ({
    ...await importActual<typeof import('@/sync/domains/session/listing/sessionListQueryRuntime')>(),
    fetchSessionListQueryPageForHome,
    isSessionListQueryHomeOnline: () => true,
    resolveOrdinarySessionListHomeOwner: () => 'concurrent',
}));

import { resolveToolSessionAddress } from './resolveToolSessionId';

const initialState = storage.getState();

describe('resolveToolSessionAddress after an off-list acquisition', () => {
    afterEach(() => {
        storage.setState(initialState, true);
    });

    it('resolves a bare id against the rows the acquisition just hydrated', async () => {
        listServerProfiles.mockReturnValue([{ id: 'home-a' }]);
        fetchSessionListQueryPageForHome.mockImplementation(async (serverId: string) => {
            storage.getState().applyServerScopedSessionListRows(serverId, [{
                id: 'fresh-session',
                updatedAt: 20,
                active: true,
                presence: 'online',
                metadata: { summaryText: 'Fresh' },
            } as never], { source: 'rowOnly', mode: 'replace' });
            return { current: true, sessionIds: ['fresh-session'], hasNext: false };
        });

        await expect(resolveToolSessionAddress({ explicitSessionId: 'fresh-session' }))
            .resolves.toEqual({ serverId: 'home-a', sessionId: 'fresh-session' });
    });
});

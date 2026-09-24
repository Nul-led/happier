import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    acquireAdmittedSessionReferenceCorpusOptions,
} from './admittedSessionReferenceCorpus';

// The two transport seams a bare-reference acquisition reaches. Everything below
// them — the pane reader, the coverage composition and the address projection —
// stays real, so this proves the acquisition and its coverage, not a stub.
const {
    listServerProfiles,
    fetchSessionListQueryPageForHome,
    isSessionListQueryHomeOnline,
    resolveOrdinarySessionListHomeOwner,
} = vi.hoisted(() => ({
    listServerProfiles: vi.fn(),
    fetchSessionListQueryPageForHome: vi.fn(),
    isSessionListQueryHomeOnline: vi.fn(),
    resolveOrdinarySessionListHomeOwner: vi.fn(),
}));

vi.mock('@/sync/domains/server/serverProfiles', async (importActual) => ({
    ...await importActual<typeof import('@/sync/domains/server/serverProfiles')>(),
    listServerProfiles,
}));

vi.mock('@/sync/domains/session/listing/sessionListQueryRuntime', async (importActual) => ({
    ...await importActual<typeof import('@/sync/domains/session/listing/sessionListQueryRuntime')>(),
    fetchSessionListQueryPageForHome,
    isSessionListQueryHomeOnline,
    resolveOrdinarySessionListHomeOwner,
}));

const NO_ORDINARY_MEMBERSHIP = { ordinarySessionListMembershipByServerId: {} } as const;

describe('acquireAdmittedSessionReferenceCorpusOptions', () => {
    beforeEach(() => {
        listServerProfiles.mockReset();
        fetchSessionListQueryPageForHome.mockReset();
        isSessionListQueryHomeOnline.mockReset();
        isSessionListQueryHomeOnline.mockReturnValue(true);
        resolveOrdinarySessionListHomeOwner.mockReset();
        resolveOrdinarySessionListHomeOwner.mockReturnValue('concurrent');
    });

    it('acquires the authorized corpus through the row-only session.list read when no pane owns one', async () => {
        listServerProfiles.mockReturnValue([{ id: 'home-a' }, { id: 'home-b' }]);
        fetchSessionListQueryPageForHome.mockImplementation(async (serverId: string) => ({
            current: true,
            sessionIds: serverId === 'home-a' ? ['s-alpha'] : ['s-beta'],
            hasNext: false,
        }));

        const corpus = await acquireAdmittedSessionReferenceCorpusOptions(NO_ORDINARY_MEMBERSHIP);

        // Off the Sessions list there is no pane, so the canonical list operation is
        // the authority — read once per reachable Home, without publishing ordinary,
        // archived or mounted-query membership.
        expect(fetchSessionListQueryPageForHome).toHaveBeenCalledTimes(2);
        expect(fetchSessionListQueryPageForHome).toHaveBeenCalledWith('home-a', expect.objectContaining({
            membership: 'rowOnly',
            source: { kind: 'ordinary', path: '/v2/sessions', allowV1Fallback: true },
        }));
        expect(corpus).toEqual({
            knownServerIds: ['home-a', 'home-b'],
            coverage: 'complete',
            addresses: [
                { serverId: 'home-a', sessionId: 's-alpha' },
                { serverId: 'home-b', sessionId: 's-beta' },
            ],
        });
    });

    it('reports incomplete coverage when a reachable Home could not be read or has more pages', async () => {
        listServerProfiles.mockReturnValue([{ id: 'home-a' }, { id: 'home-b' }]);
        fetchSessionListQueryPageForHome.mockImplementation(async (serverId: string) => {
            if (serverId === 'home-b') throw new Error('unreachable');
            return { current: true, sessionIds: ['s-alpha'], hasNext: true };
        });

        // An unread Home and an unexhausted page both leave the corpus unproven, so a
        // single local match must resolve as incomplete rather than unique.
        await expect(acquireAdmittedSessionReferenceCorpusOptions(NO_ORDINARY_MEMBERSHIP))
            .resolves.toMatchObject({ coverage: 'incomplete', addresses: [{ serverId: 'home-a', sessionId: 's-alpha' }] });
    });

    it('does not read an offline Home and reports no corpus when none is reachable', async () => {
        listServerProfiles.mockReturnValue([{ id: 'home-a' }]);
        isSessionListQueryHomeOnline.mockReturnValue(false);

        await expect(acquireAdmittedSessionReferenceCorpusOptions(NO_ORDINARY_MEMBERSHIP)).resolves.toBeNull();
        expect(fetchSessionListQueryPageForHome).not.toHaveBeenCalled();
    });

    it('keeps an offline mounted Home in the corpus as uncovered instead of dropping it', async () => {
        listServerProfiles.mockReturnValue([{ id: 'home-a' }, { id: 'home-b' }]);
        isSessionListQueryHomeOnline.mockImplementation((serverId: string) => serverId === 'home-a');
        fetchSessionListQueryPageForHome.mockResolvedValue({ current: true, sessionIds: ['deploy'], hasNext: false });

        // Home A is exhausted, but Home B is part of the selection and could hold another match.
        await expect(acquireAdmittedSessionReferenceCorpusOptions(NO_ORDINARY_MEMBERSHIP)).resolves.toEqual({
            knownServerIds: ['home-a', 'home-b'],
            coverage: 'incomplete',
            addresses: [{ serverId: 'home-a', sessionId: 'deploy' }],
        });
        expect(fetchSessionListQueryPageForHome).toHaveBeenCalledTimes(1);
    });

    it('does not count a saved Home that no runtime mounts', async () => {
        listServerProfiles.mockReturnValue([{ id: 'home-a' }, { id: 'unmounted' }]);
        resolveOrdinarySessionListHomeOwner.mockImplementation((serverId: string) => serverId === 'home-a' ? 'sync' : null);
        isSessionListQueryHomeOnline.mockImplementation((serverId: string) => serverId === 'home-a');
        fetchSessionListQueryPageForHome.mockResolvedValue({ current: true, sessionIds: ['deploy'], hasNext: false });

        await expect(acquireAdmittedSessionReferenceCorpusOptions(NO_ORDINARY_MEMBERSHIP)).resolves.toEqual({
            knownServerIds: ['home-a'],
            coverage: 'complete',
            addresses: [{ serverId: 'home-a', sessionId: 'deploy' }],
        });
    });

    it('reports incomplete coverage when a Home withheld historical rows pending their owner\'s upgrade', async () => {
        listServerProfiles.mockReturnValue([{ id: 'home-a' }]);
        fetchSessionListQueryPageForHome.mockResolvedValue({
            current: true,
            sessionIds: ['deploy'],
            hasNext: false,
            metadataUpgradeRequiredCount: 1,
        });

        await expect(acquireAdmittedSessionReferenceCorpusOptions(NO_ORDINARY_MEMBERSHIP))
            .resolves.toMatchObject({ coverage: 'incomplete' });
    });
});

import { describe, expect, it } from 'vitest';

import type { Session } from '@/sync/domains/state/storageTypes';

import { canDropSessionUnder, listPutUnderCandidates } from './putUnderCandidates';

function session(id: string, overrides: Partial<Session> = {}): Session {
    return { id, serverId: 'home', updatedAt: 1, createdAt: 1, archivedAt: null, ...overrides } as Session;
}

describe('listPutUnderCandidates', () => {
    it('offers Sessions on the same Home, never itself, its reports, archived or other-Home Sessions', () => {
        const sessions = Object.fromEntries([
            session('self'),
            session('child', { reportsTo: { sessionId: 'self' } }),
            session('grandchild', { reportsTo: { sessionId: 'child' } }),
            session('lead', { updatedAt: 5 }),
            session('peer', { updatedAt: 9 }),
            session('old', { archivedAt: 3 }),
            session('elsewhere', { serverId: 'other-home' }),
        ].map((item) => [item.id, item]));

        expect(listPutUnderCandidates(sessions, sessions.self!).map((item) => item.id)).toEqual(['peer', 'lead']);
    });
});

describe('canDropSessionUnder', () => {
    const canInput = { access: { capabilities: { submitAgentInput: true } } } as Partial<Session>;
    const sessions = Object.fromEntries([
        session('self', { ...canInput, reportsTo: { sessionId: 'lead' } }),
        session('child', { reportsTo: { sessionId: 'self' } }),
        session('grandchild', { reportsTo: { sessionId: 'child' } }),
        session('lead'),
        session('peer'),
        session('old', { archivedAt: 3 }),
        session('elsewhere', { serverId: 'other-home' }),
        session('viewer'),
    ].map((item) => [item.id, item]));

    it('accepts a drop on a Session that could lead this one', () => {
        expect(canDropSessionUnder(sessions, 'self', 'peer')).toBe(true);
    });

    it('refuses its current lead, itself, its own reports, archived and other-Home Sessions', () => {
        for (const target of ['lead', 'self', 'child', 'grandchild', 'old', 'elsewhere', 'missing']) {
            expect(canDropSessionUnder(sessions, 'self', target)).toBe(false);
        }
    });

    it('refuses a Session the viewer cannot steer', () => {
        expect(canDropSessionUnder(sessions, 'viewer', 'peer')).toBe(false);
    });
});

import { describe, expect, it } from 'vitest';

import { resolveConnectMoreBlockForRequest, selectConnectMoreOffer, CONNECT_MORE_BROWSE_ID } from './connectMoreBlocks';

type Entry = Parameters<typeof selectConnectMoreOffer>[0]['addable'][number];

function entry(serviceKey: string, fields: Partial<Entry> & Readonly<{ oauth?: boolean }> = {}): Entry {
    return {
        serviceKey,
        service: { pluginId: 'p', localId: serviceKey },
        entry: { authenticationModes: [{ id: 'm', kind: fields.oauth ? 'oauthAuthorizationCode' : 'manual' }] } as never,
        legacyServiceId: null,
        label: serviceKey,
        usedBy: ['Codex'],
        usedByAgentIds: ['codex'],
        connectedCount: 0,
        section: 'agents',
        canAdd: true,
        ...fields,
    };
}

describe('selectConnectMoreOffer', () => {
    const claude = entry('claude', { oauth: true });
    const gemini = entry('gemini');
    const keyed = entry('anthropic', { connectedCount: 1 });
    const github = entry('github', { section: 'tools', usedBy: [], usedByAgentIds: [] });

    it('offers, on the page, the agents’ services nobody connected and nobody set aside, and browses the rest', () => {
        const offer = selectConnectMoreOffer({
            layout: 'section',
            addable: [claude, gemini, keyed, github],
            connectableKeys: new Set(['claude', 'gemini']),
            hidden: new Set(['connect:gemini']),
        });
        expect(offer.offered.map((candidate) => candidate.serviceKey)).toEqual(['claude']);
        expect(offer.browse).toBe(true);
    });

    it('offers, on first run, the plans people sign in with; keys, code hosts and tools wait behind browse', () => {
        const offer = selectConnectMoreOffer({
            layout: 'firstRun',
            addable: [claude, gemini, github],
            connectableKeys: new Set(['claude', 'gemini']),
            hidden: new Set(),
        });
        expect(offer.offered.map((candidate) => candidate.serviceKey)).toEqual(['claude']);
        expect(offer.browse).toBe(true);
    });

    it('does not browse when every addable service is already a block', () => {
        const offer = selectConnectMoreOffer({
            layout: 'section',
            addable: [claude],
            connectableKeys: new Set(['claude']),
            hidden: new Set(),
        });
        expect(offer.browse).toBe(false);
    });
});

describe('resolveConnectMoreBlockForRequest', () => {
    const offered = [entry('gemini')];

    it('opens a requested service from its own block when it has one, else from browse', () => {
        expect(resolveConnectMoreBlockForRequest({ request: { kind: 'service', serviceKey: 'gemini' }, offered, browse: true, openId: null })).toBe('gemini');
        expect(resolveConnectMoreBlockForRequest({ request: { kind: 'service', serviceKey: 'claude' }, offered, browse: true, openId: null })).toBe(CONNECT_MORE_BROWSE_ID);
        expect(resolveConnectMoreBlockForRequest({ request: { kind: 'reconnect', serviceKey: 'gemini', accountId: 'a' }, offered, browse: true, openId: null })).toBe(CONNECT_MORE_BROWSE_ID);
        expect(resolveConnectMoreBlockForRequest({ request: { kind: 'catalog' }, offered, browse: true, openId: null })).toBe(CONNECT_MORE_BROWSE_ID);
    });

    it('keeps an open panel where it is (the panel follows the new target)', () => {
        expect(resolveConnectMoreBlockForRequest({ request: { kind: 'catalog' }, offered, browse: true, openId: 'gemini' })).toBe('gemini');
    });
});

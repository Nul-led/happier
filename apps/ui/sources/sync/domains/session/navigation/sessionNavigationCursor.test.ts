import { describe, expect, it } from 'vitest';

import {
    buildSessionNavigationCursor,
    resolveSessionNavigationCursorStep,
    type SessionNavigationCursorIdentity,
} from './sessionNavigationCursor';
import {
    buildServerScopedSessionKey,
    resolveSessionMruNavigation,
    type SessionListLikeItem,
} from './sessionNavigationOrder';

const identity: SessionNavigationCursorIdentity = {
    origin: 'session-list',
    sourceScopeKey: 'scope-1',
    storageKind: 'all',
};

const header = (): SessionListLikeItem => ({ type: 'header' });
const session = (id: string, serverId?: string): SessionListLikeItem => ({ type: 'session', serverId, sessionId: id });

function buildCursorFrom(items: readonly SessionListLikeItem[]) {
    return buildSessionNavigationCursor({ identity, items, nowMs: 1_000 });
}

describe('session navigation cursor', () => {
    it('builds from stage-C list items, skipping headers and rows without a session id', () => {
        const cursor = buildCursorFrom([
            header(),
            session('alpha', 'server-a'),
            { type: 'session', serverId: 'server-a', sessionId: '  ' },
            header(),
            session('beta', 'server-a'),
        ]);

        expect(cursor).not.toBeNull();
        expect(cursor?.entries.map((entry) => entry.sessionKey)).toEqual([buildServerScopedSessionKey('alpha', 'server-a'), buildServerScopedSessionKey('beta', 'server-a')]);
        expect(cursor?.capturedAtMs).toBe(1_000);
        expect(cursor?.identity).toEqual(identity);
    });

    it('returns null when fewer than two navigable entries were captured', () => {
        expect(buildCursorFrom([header(), session('alpha', 'server-a')])).toBeNull();
        expect(buildCursorFrom([])).toBeNull();
    });

    it('preserves server-scoped keys so one session id on two servers is two entries', () => {
        const cursor = buildCursorFrom([session('alpha', 'server-a'), session('alpha', 'server-b')]);

        expect(cursor?.entries.map((entry) => entry.sessionKey)).toEqual([buildServerScopedSessionKey('alpha', 'server-a'), buildServerScopedSessionKey('alpha', 'server-b')]);
        expect(resolveSessionNavigationCursorStep({
            cursor,
            anchorSessionKey: buildServerScopedSessionKey('alpha', 'server-a'),
            direction: 'next',
        })).toMatchObject({ kind: 'target', cursorSessionKey: buildServerScopedSessionKey('alpha', 'server-b') });
    });

    it('steps through the frozen order even when the live list would have reordered', () => {
        const frozen = buildCursorFrom([
            session('alpha', 'server-a'),
            session('beta', 'server-a'),
            session('gamma', 'server-a'),
        ]);
        const live = buildCursorFrom([
            session('gamma', 'server-a'),
            session('beta', 'server-a'),
            session('alpha', 'server-a'),
        ]);

        expect(resolveSessionNavigationCursorStep({
            cursor: frozen,
            anchorSessionKey: buildServerScopedSessionKey('alpha', 'server-a'),
            direction: 'next',
        })).toMatchObject({ kind: 'target', cursorSessionKey: buildServerScopedSessionKey('beta', 'server-a') });
        // The same step against the reordered live order is an edge, so the frozen
        // result above cannot have come from the current list order.
        expect(resolveSessionNavigationCursorStep({
            cursor: live,
            anchorSessionKey: buildServerScopedSessionKey('alpha', 'server-a'),
            direction: 'next',
        })).toEqual({ kind: 'edge' });
    });

    it('skips a rejected target and continues in the same direction', () => {
        const cursor = buildCursorFrom([
            session('alpha', 'server-a'),
            session('beta', 'server-a'),
            session('gamma', 'server-a'),
        ]);

        expect(resolveSessionNavigationCursorStep({
            cursor,
            anchorSessionKey: buildServerScopedSessionKey('alpha', 'server-a'),
            direction: 'next',
            isEntryNavigable: (entry) => entry.sessionKey !== buildServerScopedSessionKey('beta', 'server-a'),
        })).toMatchObject({ kind: 'target', cursorSessionKey: buildServerScopedSessionKey('gamma', 'server-a') });
    });

    it('reports an edge when every remaining entry in that direction is unnavigable', () => {
        const cursor = buildCursorFrom([
            session('alpha', 'server-a'),
            session('beta', 'server-a'),
            session('gamma', 'server-a'),
        ]);

        expect(resolveSessionNavigationCursorStep({
            cursor,
            anchorSessionKey: buildServerScopedSessionKey('alpha', 'server-a'),
            direction: 'next',
            isEntryNavigable: (entry) => entry.sessionKey === buildServerScopedSessionKey('alpha', 'server-a'),
        })).toEqual({ kind: 'edge' });
    });

    it('reports unavailable when the anchor is absent instead of falling back to an end entry', () => {
        const cursor = buildCursorFrom([
            session('alpha', 'server-a'),
            session('beta', 'server-a'),
        ]);

        expect(resolveSessionNavigationCursorStep({
            cursor,
            anchorSessionKey: buildServerScopedSessionKey('missing', 'server-a'),
            direction: 'next',
        })).toEqual({ kind: 'unavailable' });
        expect(resolveSessionNavigationCursorStep({
            cursor,
            anchorSessionKey: null,
            direction: 'previous',
        })).toEqual({ kind: 'unavailable' });
        expect(resolveSessionNavigationCursorStep({
            cursor: null,
            anchorSessionKey: buildServerScopedSessionKey('alpha', 'server-a'),
            direction: 'next',
        })).toEqual({ kind: 'unavailable' });
    });

    it('keeps repeated steps anchored to the returned cursor key rather than the route session', () => {
        const cursor = buildCursorFrom([
            session('alpha', 'server-a'),
            session('beta', 'server-a'),
            session('gamma', 'server-a'),
        ]);

        const first = resolveSessionNavigationCursorStep({
            cursor,
            anchorSessionKey: buildServerScopedSessionKey('alpha', 'server-a'),
            direction: 'next',
        });
        expect(first.kind).toBe('target');
        const second = resolveSessionNavigationCursorStep({
            cursor,
            anchorSessionKey: first.kind === 'target' ? first.cursorSessionKey : null,
            direction: 'next',
        });

        expect(second).toMatchObject({ kind: 'target', cursorSessionKey: buildServerScopedSessionKey('gamma', 'server-a') });
    });

    it('clamps at both ends and never wraps, unlike MRU navigation', () => {
        const cursor = buildCursorFrom([
            session('alpha', 'server-a'),
            session('beta', 'server-a'),
            session('gamma', 'server-a'),
        ]);

        expect(resolveSessionNavigationCursorStep({
            cursor,
            anchorSessionKey: buildServerScopedSessionKey('gamma', 'server-a'),
            direction: 'next',
        })).toEqual({ kind: 'edge' });
        expect(resolveSessionNavigationCursorStep({
            cursor,
            anchorSessionKey: buildServerScopedSessionKey('alpha', 'server-a'),
            direction: 'previous',
        })).toEqual({ kind: 'edge' });

        // MRU navigation over the same order wraps; the cursor must not.
        expect(resolveSessionMruNavigation({
            order: [buildServerScopedSessionKey('alpha', 'server-a'), buildServerScopedSessionKey('beta', 'server-a'), buildServerScopedSessionKey('gamma', 'server-a')],
            knownSessionEntries: cursor?.entries ?? [],
            activeSessionKey: buildServerScopedSessionKey('alpha', 'server-a'),
            cursorSessionKey: null,
            direction: 'next',
        })?.sessionKey).toBe(buildServerScopedSessionKey('gamma', 'server-a'));
    });
});

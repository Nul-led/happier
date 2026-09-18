import { describe, expect, it } from 'vitest';
import { normalizeSessionAddress, sessionAddressKey, areSessionAddressesEqual } from '../sessionAddress';

describe('sessionListKeyNormalization', () => {
    it('does not collide when either address part contains the old separator', async () => {
        const { buildSessionListServerScopedRowKey } = await import('./sessionListKeyNormalization');
        expect(buildSessionListServerScopedRowKey('home\u0000part', 'session'))
            .not.toBe(buildSessionListServerScopedRowKey('home', 'part\u0000session'));
    });

    it('rejects non-string identity parts instead of coercing them', async () => {
        const { buildSessionListServerScopedRowKey } = await import('./sessionListKeyNormalization');
        expect(buildSessionListServerScopedRowKey(12, 'session')).toBeNull();
        expect(buildSessionListServerScopedRowKey('home', { toString: () => 'session' })).toBeNull();
    });
    it('normalizes server and session keys from the same canonical parts helper', async () => {
        const { normalizeSessionListKeyParts } = await import('./sessionListKeyNormalization');
        const parts = normalizeSessionListKeyParts('  server-a  ', '  session-1  ');

        expect(parts).toEqual({
            serverId: 'server-a',
            sessionId: 'session-1',
            serverKey: 'server-a',
            sessionKey: sessionAddressKey({ serverId: 'server-a', sessionId: 'session-1' }),
        });
    });

    it('normalizes structured addresses without interpreting URL-shaped Home ids', () => {
        const address = normalizeSessionAddress(' https://home.example:8443/path ', ' session-1 ');
        expect(address).toEqual({ serverId: 'https://home.example:8443/path', sessionId: 'session-1' });
        expect(areSessionAddressesEqual(address, normalizeSessionAddress('https://home.example:8443/path', 'session-1'))).toBe(true);
        expect(areSessionAddressesEqual(address, normalizeSessionAddress('other', 'session-1'))).toBe(false);
        expect(normalizeSessionAddress(' ', 'session-1')).toBeNull();
        expect(normalizeSessionAddress('home', '')).toBeNull();
    });

    it('reuses the shared empty server key and omits invalid session keys', async () => {
        const { EMPTY_SESSION_LIST_SERVER_KEY, normalizeSessionListKeyParts } = await import(
            './sessionListKeyNormalization'
        );
        const parts = normalizeSessionListKeyParts('   ', '   ');

        expect(parts).toEqual({
            serverId: '',
            sessionId: '',
            serverKey: EMPTY_SESSION_LIST_SERVER_KEY,
            sessionKey: null,
        });
    });

    it('builds row-scope keys without reusing the tag key separator', async () => {
        const {
            buildSessionListRowScopeKey,
            buildSessionListServerScopedRowKey,
            normalizeSessionListKeyParts,
        } = await import('./sessionListKeyNormalization');

        expect(normalizeSessionListKeyParts(' server-a ', ' session-1 ').sessionKey).toBe(
            sessionAddressKey({ serverId: 'server-a', sessionId: 'session-1' }),
        );
        const key = sessionAddressKey({ serverId: 'server-a', sessionId: 'session-1' });
        expect(buildSessionListServerScopedRowKey(' server-a ', ' session-1 ')).toBe(key);
        expect(buildSessionListRowScopeKey(' server-a ', ' session-1 ')).toBe(key);
        expect(buildSessionListServerScopedRowKey(null, ' session-1 ')).toBeNull();
        expect(buildSessionListRowScopeKey(null, ' session-1 ')).toBe('session-1');
    });

});

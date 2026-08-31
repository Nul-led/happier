import { describe, expect, it } from 'vitest';

import { encodeBase64, decodeBase64 } from '@/encryption/base64';
import {
    buildHomeQrInviteDeepLink,
    buildHomeQrInviteRestoreRoutePath,
    buildPairingDeepLink,
    parseHomeQrInviteDeepLink,
    parsePairingDeepLink,
} from './pairingUrl';

const INVITE_BASE = {
    v: 2 as const,
    intent: 'home_device' as const,
    pairId: 'pair-1',
    home: {
        v: 1 as const,
        homeServerIdentityId: 'srv_home_b',
        canonicalServerUrl: 'https://home-b.test',
        revision: 1,
        endpoints: [{ kind: 'https' as const, url: 'https://home-b.test' }],
    },
    qrSecretBase64Url: encodeBase64(new Uint8Array(32).fill(3), 'base64url'),
    issuedAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
};

describe('HomeQrInviteV2 deep link', () => {
    it('builds one opaque bounded payload carrying the strict invite', () => {
        const link = buildHomeQrInviteDeepLink({ invite: INVITE_BASE });
        expect(link).toMatch(/^happier:\/\/\/pair\?v=2&payload=/);
        expect(link).not.toContain('qrSecret');
        expect(link).not.toContain(encodeURIComponent(INVITE_BASE.qrSecretBase64Url));
        expect(link.length).toBeLessThan(4_096);
    });

    it('round-trips the invite through the strict protocol schema', () => {
        const link = buildHomeQrInviteDeepLink({ invite: INVITE_BASE });
        expect(parseHomeQrInviteDeepLink(link)).toEqual({ invite: INVITE_BASE });
    });

    it('routes the unchanged opaque V2 link to the restore owner', () => {
        const link = buildHomeQrInviteDeepLink({ invite: INVITE_BASE });
        expect(buildHomeQrInviteRestoreRoutePath(link)).toBe(
            `/restore?pairingLink=${encodeURIComponent(link)}`,
        );
        expect(buildHomeQrInviteRestoreRoutePath('happier:///pair?v=1&pairId=p&secret=s')).toBeNull();
    });

    it('rejects v=2 links with extra query parameters', () => {
        const link = buildHomeQrInviteDeepLink({ invite: INVITE_BASE });
        expect(parseHomeQrInviteDeepLink(`${link}&secret=leaked`)).toBeNull();
        expect(parseHomeQrInviteDeepLink(`${link}&pairId=x`)).toBeNull();
    });

    it('rejects oversized payloads', () => {
        const oversized = encodeBase64(new TextEncoder().encode(JSON.stringify({
            ...INVITE_BASE,
            pairId: 'p'.repeat(8_000),
        })), 'base64url');
        expect(parseHomeQrInviteDeepLink(`happier:///pair?v=2&payload=${oversized}`)).toBeNull();
    });

    it('rejects malformed payload bytes and schema-invalid invites', () => {
        expect(parseHomeQrInviteDeepLink('happier:///pair?v=2&payload=!!!not-base64!!!')).toBeNull();
        const manualPayloadLink = (value: unknown): string =>
            `happier:///pair?v=2&payload=${encodeURIComponent(encodeBase64(new TextEncoder().encode(JSON.stringify(value)), 'base64url'))}`;
        expect(parseHomeQrInviteDeepLink(manualPayloadLink({ v: 2 }))).toBeNull();
        // Wrong qrSecret length must fail the schema.
        expect(parseHomeQrInviteDeepLink(manualPayloadLink({
            ...INVITE_BASE,
            qrSecretBase64Url: encodeBase64(new Uint8Array(16), 'base64url'),
        }))).toBeNull();
        // Unsupported intent must fail the schema.
        expect(parseHomeQrInviteDeepLink(manualPayloadLink({
            ...INVITE_BASE,
            intent: 'something_else',
        }))).toBeNull();
        // Building from an invalid invite fails closed instead of emitting a link.
        expect(() => buildHomeQrInviteDeepLink({
            invite: { ...INVITE_BASE, qrSecretBase64Url: encodeBase64(new Uint8Array(16), 'base64url') },
        })).toThrow();
        // Unbounded invite lifetime must fail client-side TTL validation.
        const endless = { ...INVITE_BASE, expiresAtMs: INVITE_BASE.issuedAtMs + 24 * 60 * 60 * 1000 };
        expect(parseHomeQrInviteDeepLink(manualPayloadLink(endless))).toBeNull();
        expect(() => buildHomeQrInviteDeepLink({ invite: endless })).toThrow();
    });

    it('rejects non-pair routes and wrong versions', () => {
        const payload = encodeBase64(new TextEncoder().encode(JSON.stringify(INVITE_BASE)), 'base64url');
        expect(parseHomeQrInviteDeepLink(`happier:///other?v=2&payload=${payload}`)).toBeNull();
        expect(parseHomeQrInviteDeepLink(`happier:///pair?v=1&payload=${payload}`)).toBeNull();
        expect(parseHomeQrInviteDeepLink('happier:///pair?v=2')).toBeNull();
    });
});

describe('V1 pairing deep link compatibility', () => {
    it('keeps released V1 links parse-only and refuses new V1 issuance', () => {
        expect(parsePairingDeepLink('happier:///pair?v=1&pairId=p&secret=s&server=https%3A%2F%2Fhome.test')).toEqual({
            pairId: 'p',
            secret: 's',
            serverUrl: 'https://home.test',
        });
        expect(() => buildPairingDeepLink({ pairId: 'p', secret: 's' })).toThrowError(
            expect.objectContaining({ code: 'legacy_provisioning_unavailable' }),
        );
        // A V1 link must not be mistaken for a V2 invite.
        expect(parseHomeQrInviteDeepLink('happier:///pair?v=1&pairId=p&secret=s')).toBeNull();
    });

    it('v2 payload decodes back to the exact qr secret bytes', () => {
        const link = buildHomeQrInviteDeepLink({ invite: INVITE_BASE });
        const parsed = parseHomeQrInviteDeepLink(link);
        expect(parsed?.invite.qrSecretBase64Url).toBe(INVITE_BASE.qrSecretBase64Url);
        expect(decodeBase64(parsed?.invite.qrSecretBase64Url ?? '', 'base64url').length).toBe(32);
    });
});

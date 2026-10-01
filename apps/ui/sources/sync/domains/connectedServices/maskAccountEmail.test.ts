import { describe, expect, it } from 'vitest';

import { maskAccountEmail, presentConnectedAccountIdentity, splitMaskedConnectedAccountIdentity } from './maskAccountEmail';

describe('maskAccountEmail', () => {
    it('keeps two local letters, one domain letter, and the top-level domain', () => {
        expect(maskAccountEmail('kevin@gmail.com')).toBe('ke•••@g•••.com');
        expect(maskAccountEmail('p.lee@kakao.co.kr')).toBe('p.•••@k•••.kr');
    });

    it('projects the same privacy policy for email and account id', () => {
        const input = { label: 'Work', email: 'kevin@gmail.com', accountId: 'account-123' };
        expect(presentConnectedAccountIdentity({ ...input, hidden: false })).toEqual({
            label: 'Work', email: 'kevin@gmail.com', accountId: 'account-123',
        });
        expect(presentConnectedAccountIdentity({ ...input, hidden: true })).toEqual({
            label: 'Work', email: 'ke•••@g•••.com', accountId: 'accou•••23',
        });
    });

    it('keeps names people gave their accounts and masks a label that is itself the email (lab csvc PV)', () => {
        expect(presentConnectedAccountIdentity({ hidden: true, label: 'Team · Acme', email: null, accountId: null }).label)
            .toBe('Team · Acme');
        expect(presentConnectedAccountIdentity({ hidden: true, label: 'kevin@gmail.com', email: 'kevin@gmail.com', accountId: null }).label)
            .toBe('ke•••@g•••.com');
    });

    it('keeps enough of a long account id to tell accounts apart: its prefix and last two characters', () => {
        expect(presentConnectedAccountIdentity({ hidden: true, label: null, email: null, accountId: 'user-4fQk8TzW1c' }).accountId)
            .toBe('user-•••1c');
    });

    it('returns null for anything that is not an email, so the caller falls back to another name', () => {
        expect(maskAccountEmail('not-an-email')).toBeNull();
        expect(maskAccountEmail('')).toBeNull();
        expect(maskAccountEmail(null)).toBeNull();
    });

    it('names the hidden runs of a masked identity, so a surface can blur exactly those and keep the rest readable', () => {
        expect(splitMaskedConnectedAccountIdentity('ke•••@g•••.com')).toEqual([
            { text: 'ke', masked: false },
            { text: '•••', masked: true },
            { text: '@g', masked: false },
            { text: '•••', masked: true },
            { text: '.com', masked: false },
        ]);
        expect(splitMaskedConnectedAccountIdentity('Work')).toEqual([{ text: 'Work', masked: false }]);
    });
});

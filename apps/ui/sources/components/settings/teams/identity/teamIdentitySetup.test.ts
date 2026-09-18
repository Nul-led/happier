import { describe, expect, it } from 'vitest';

import {
    connectionSettingsFromDraft,
    parseIdentityList,
} from './teamIdentitySetup';

describe('Team identity setup values', () => {
    it('normalizes list fields and removes duplicates before writing settings', () => {
        expect(parseIdentityList(' Alice@example.com, bob@example.com\nalice@example.com ')).toEqual([
            'Alice@example.com',
            'bob@example.com',
            'alice@example.com',
        ]);
        expect(connectionSettingsFromDraft({
            allowedUsers: 'alice, alice',
            allowedEmailDomains: 'example.com',
            groupsAny: 'engineering\nproduct',
            groupsAll: '',
        })).toEqual({
            v: 1,
            kind: 'oidc',
            allowedUsers: ['alice'],
            allowedEmailDomains: ['example.com'],
            groupsAny: ['engineering', 'product'],
            groupsAll: [],
        });
    });
});

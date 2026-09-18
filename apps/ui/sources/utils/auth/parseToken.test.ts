import { describe, expect, it } from 'vitest';

import { parseToken } from './parseToken';

describe('parseToken', () => {
    it('reads an unpadded JWT base64url subject', () => {
        expect(parseToken('e30.eyJzdWIiOiJhY2NvdW50LWFkYSJ9.signature')).toBe('account-ada');
    });
});

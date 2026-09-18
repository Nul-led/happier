import { describe, expect, it } from 'vitest';
import { formatAccountDisplayName } from './formatAccountDisplayName';

describe('formatAccountDisplayName', () => {
    it('uses trimmed current names before username, with an explicit unnamed result', () => {
        expect(formatAccountDisplayName({ firstName: ' Alice ', lastName: ' Chen ', username: 'alice', avatarUrl: null })).toBe('Alice Chen');
        expect(formatAccountDisplayName({ firstName: ' ', lastName: null, username: ' alice ', avatarUrl: null })).toBe('@alice');
        expect(formatAccountDisplayName({ firstName: null, lastName: null, username: ' ', avatarUrl: null })).toBeNull();
    });
});

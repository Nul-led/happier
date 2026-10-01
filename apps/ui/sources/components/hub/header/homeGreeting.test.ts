import { describe, expect, it } from 'vitest';

import { resolveHomeGreeting } from './homeGreeting';

describe('home greeting', () => {
    it('greets by the time of day, with the name when there is one', () => {
        expect(resolveHomeGreeting({ hour: 8, name: 'Leeroy' })).toBe('Good morning, Leeroy');
        expect(resolveHomeGreeting({ hour: 14, name: 'Leeroy' })).toBe('Good afternoon, Leeroy');
        expect(resolveHomeGreeting({ hour: 21, name: 'Leeroy' })).toBe('Good evening, Leeroy');
        // After midnight is still the evening, not the morning.
        expect(resolveHomeGreeting({ hour: 2, name: 'Leeroy' })).toBe('Good evening, Leeroy');
        expect(resolveHomeGreeting({ hour: 12, name: null })).toBe('Good afternoon');
    });
});

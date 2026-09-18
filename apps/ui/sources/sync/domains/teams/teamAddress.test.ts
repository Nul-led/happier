import { describe, expect, it } from 'vitest';

import { createServerAccountScope } from '@/sync/domains/scope/serverAccountScope';

import {
    areTeamAddressesEqual,
    createTeamAddress,
    serverAccountScopedTeamKey,
    serverAccountScopedTeamResourceKey,
    teamAddressKey,
} from './teamAddress';

describe('createTeamAddress', () => {
    it('trims both parts and rejects anything that is not a usable identity', () => {
        expect(createTeamAddress('  home_1 ', ' team_1 ')).toEqual({ serverId: 'home_1', teamId: 'team_1' });
        expect(createTeamAddress('', 'team_1')).toBeNull();
        expect(createTeamAddress('home_1', '   ')).toBeNull();
        expect(createTeamAddress(null, 'team_1')).toBeNull();
        expect(createTeamAddress('home_1', undefined)).toBeNull();
        expect(createTeamAddress(7, 'team_1')).toBeNull();
    });

    it('never infers the Home from the Team identity', () => {
        // A Team ID alone cannot address a Team: two Homes may both hold it.
        expect(createTeamAddress(undefined, 'team_1')).toBeNull();
    });
});

describe('areTeamAddressesEqual', () => {
    it('separates the same Team ID on two different Homes', () => {
        const a = createTeamAddress('home_a', 'team_1');
        const b = createTeamAddress('home_b', 'team_1');
        expect(areTeamAddressesEqual(a, a)).toBe(true);
        expect(areTeamAddressesEqual(a, createTeamAddress('home_a', 'team_1'))).toBe(true);
        expect(areTeamAddressesEqual(a, b)).toBe(false);
    });

    it('treats a missing address as unequal rather than as a wildcard', () => {
        const a = createTeamAddress('home_a', 'team_1');
        expect(areTeamAddressesEqual(a, null)).toBe(false);
        expect(areTeamAddressesEqual(null, null)).toBe(false);
        expect(areTeamAddressesEqual(undefined, a)).toBe(false);
    });
});

describe('teamAddressKey', () => {
    it('cannot be collided by moving separator-looking characters between the parts', () => {
        const left = createTeamAddress('home:1', 'team');
        const right = createTeamAddress('home', '1:team');
        expect(left).not.toBeNull();
        expect(right).not.toBeNull();
        expect(teamAddressKey(left!)).not.toBe(teamAddressKey(right!));
    });

    it('is stable for equal addresses', () => {
        expect(teamAddressKey(createTeamAddress('home_a', 'team_1')!))
            .toBe(teamAddressKey(createTeamAddress(' home_a', 'team_1 ')!));
    });
});

describe('serverAccountScopedTeamKey', () => {
    it('keeps two Accounts on one Home from sharing a Team cache entry', () => {
        const address = createTeamAddress('home_a', 'team_1')!;
        const first = createServerAccountScope('home_a', 'acc_1')!;
        const second = createServerAccountScope('home_a', 'acc_2')!;
        expect(serverAccountScopedTeamKey(first, address))
            .not.toBe(serverAccountScopedTeamKey(second, address));
    });

    it('keeps the same Account on two Homes from sharing a Team cache entry', () => {
        const first = createServerAccountScope('home_a', 'acc_1')!;
        const second = createServerAccountScope('home_b', 'acc_1')!;
        expect(serverAccountScopedTeamKey(first, createTeamAddress('home_a', 'team_1')!))
            .not.toBe(serverAccountScopedTeamKey(second, createTeamAddress('home_b', 'team_1')!));
    });

    it('is stable for one scope and Team', () => {
        const scope = createServerAccountScope('home_a', 'acc_1')!;
        const address = createTeamAddress('home_a', 'team_1')!;
        expect(serverAccountScopedTeamKey(scope, address)).toBe(serverAccountScopedTeamKey(scope, address));
    });
});

describe('serverAccountScopedTeamResourceKey', () => {
    it('cannot collide when opaque resource and filter parts contain former delimiters', () => {
        const scope = createServerAccountScope('home', 'account')!;
        const address = createTeamAddress('home', 'team')!;
        expect(serverAccountScopedTeamResourceKey(scope, address, 'members', 'active\u0000guest'))
            .not.toBe(serverAccountScopedTeamResourceKey(scope, address, 'members\u0000active', 'guest'));
    });
});

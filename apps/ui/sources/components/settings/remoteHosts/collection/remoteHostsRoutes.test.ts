import { describe, expect, it } from 'vitest';

import { REMOTE_HOSTS_NEW_ROUTE, remoteHostHref, resolveRemoteHostsLandingHref } from './remoteHostsRoutes';

describe('resolveRemoteHostsLandingHref', () => {
    it('lands beside the rail on the last host, else the first, else the new-host draft', () => {
        expect(resolveRemoteHostsLandingHref(['a', 'b'], 'b')).toBe(remoteHostHref('b'));
        expect(resolveRemoteHostsLandingHref(['a', 'b'], null)).toBe(remoteHostHref('a'));
        expect(resolveRemoteHostsLandingHref([], null)).toBe(REMOTE_HOSTS_NEW_ROUTE);
    });

    it('opens the new-host draft when search asked for "Add host", whatever was open before', () => {
        expect(resolveRemoteHostsLandingHref(['a', 'b'], 'b', { addHostRequested: true })).toBe(REMOTE_HOSTS_NEW_ROUTE);
    });
});

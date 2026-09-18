import { describe, expect, it } from 'vitest';
import { parseAccountServiceRouteInput, createAccountServiceReturn } from './accountDirectoryNavigation';

describe('Account Service navigation custody', () => {
    it('keeps explicit entry distinct from authenticated linking and rejects credential-bearing endpoints', () => {
        const route = {
            accountServiceEndpoint: 'https://directory.test',
            accountServiceIdentity: 'srv_directory',
            accountIntent: JSON.stringify({ kind: 'enter', target: { kind: 'explicit', homeServerIdentityId: 'srv_a' } }),
        };
        expect(parseAccountServiceRouteInput(route)).toEqual({
            endpoint: 'https://directory.test', serverIdentityId: 'srv_directory',
            intent: { kind: 'enter', target: { kind: 'explicit', homeServerIdentityId: 'srv_a' } },
        });
        expect(parseAccountServiceRouteInput({ ...route, accountServiceEndpoint: 'https://secret@directory.test' })).toBeNull();
        expect(parseAccountServiceRouteInput({ ...route, accountIntent: JSON.stringify({ kind: 'link' }) })).toBeNull();
    });
    it('projects only non-secret custody onto the recorded internal return surface', () => {
        const pending = {
            endpoint: 'https://directory.test', serverIdentityId: 'srv_directory',
            entryIntent: { kind: 'enter' as const, target: { kind: 'automatic' as const } },
            returnTo: '/setup/wizard', token: 'never-return', secret: 'never-return',
        };
        expect(createAccountServiceReturn(pending)).toEqual({ pathname: '/setup/wizard', params: {
            mode: 'account-entry',
            accountServiceEndpoint: pending.endpoint, accountServiceIdentity: pending.serverIdentityId,
            accountIntent: JSON.stringify(pending.entryIntent), accountServiceReturn: '1',
        } });
        expect(createAccountServiceReturn({ ...pending, returnTo: '//external.test' })).toBeNull();
    });
});

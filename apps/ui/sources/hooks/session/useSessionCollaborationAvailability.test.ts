import { describe, expect, it } from 'vitest';
import {
    resolveSessionCollaborationAvailability,
    resolveSessionCollaborationDestinationAdmitted,
    canCreateSessionWithInitialAccess,
} from './useSessionCollaborationAvailability';

describe('Session collaboration availability', () => {
    it('refuses to create with named access on a direct-only Home without blocking Private creation', () => {
        const access = { grants: [{ subject: { kind: 'account' as const, accountId: 'person' }, accessLevel: 'view' as const, canApprovePermissions: false }] };
        expect(canCreateSessionWithInitialAccess(access, 'direct_only')).toBe(false);
        expect(canCreateSessionWithInitialAccess(access, 'unavailable')).toBe(false);
        expect(canCreateSessionWithInitialAccess(access, 'full_collaboration')).toBe(true);
        expect(canCreateSessionWithInitialAccess(null, 'direct_only')).toBe(true);
        expect(canCreateSessionWithInitialAccess({ grants: [] }, 'unavailable')).toBe(true);
    });
    it('keeps released direct access available independently of the new collaboration operation', () => {
        expect(resolveSessionCollaborationAvailability(true, false)).toBe('direct_only');
        expect(resolveSessionCollaborationAvailability(true, true)).toBe('full_collaboration');
    });
    it('fails closed when sharing is unavailable, even if the collaboration decision is enabled', () => {
        expect(resolveSessionCollaborationAvailability(false, true)).toBe('unavailable');
        expect(resolveSessionCollaborationAvailability(false, false)).toBe('unavailable');
    });
    it('admits the destination for a Home that publishes links while named access is off', () => {
        // `sharing.public` has no catalog dependency on `sharing.session`, so this
        // Home is reachable — and publication has no other entry point.
        expect(resolveSessionCollaborationDestinationAdmitted({ namedAccess: 'unavailable', publicLinkEnabled: true })).toBe(true);
        expect(resolveSessionCollaborationDestinationAdmitted({ namedAccess: 'direct_only', publicLinkEnabled: false })).toBe(true);
        expect(resolveSessionCollaborationDestinationAdmitted({ namedAccess: 'full_collaboration', publicLinkEnabled: false })).toBe(true);
    });
    it('hides the destination only when no child intent is supported at all', () => {
        expect(resolveSessionCollaborationDestinationAdmitted({ namedAccess: 'unavailable', publicLinkEnabled: false })).toBe(false);
    });
});

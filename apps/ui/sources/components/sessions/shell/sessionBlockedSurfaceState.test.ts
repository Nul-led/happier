import { describe, expect, it } from 'vitest';

import {
    projectSessionBlockedSurfacePresentation,
    resolveSessionBlockedSurfaceState,
} from './sessionBlockedSurfaceState';

const AUTH = { message: 'restore this account' } as const;

describe('Session blocked surface precedence', () => {
    it('puts Account recovery ahead of an unreadable cached Session', () => {
        expect(resolveSessionBlockedSurfaceState({
            authSurfaceState: AUTH,
            routeHydrationState: { kind: 'missing', sessionId: 's1', cause: 'unauthorized' },
            sessionPresent: true,
            contentAvailability: 'encrypted_access_pending',
        })).toEqual({ kind: 'account_recovery', auth: AUTH });
    });

    it.each([true, false])(
        'reports an explicit denial as access removed even when a Session is cached (cached: %s)',
        (sessionPresent) => {
            expect(resolveSessionBlockedSurfaceState({
                authSurfaceState: null,
                routeHydrationState: { kind: 'missing', sessionId: 's1', cause: 'forbidden' },
                sessionPresent,
                contentAvailability: sessionPresent ? 'ready' : null,
            })).toEqual({ kind: 'access_denied' });
        },
    );

    it('keeps denial ahead of encrypted delivery state', () => {
        expect(resolveSessionBlockedSurfaceState({
            authSurfaceState: null,
            routeHydrationState: { kind: 'missing', sessionId: 's1', cause: 'forbidden' },
            sessionPresent: true,
            contentAvailability: 'encrypted_access_needs_repair',
        })).toEqual({ kind: 'access_denied' });
    });

    it('leaves an ambiguous missing Session to the existing unavailable presentation', () => {
        expect(resolveSessionBlockedSurfaceState({
            authSurfaceState: null,
            routeHydrationState: { kind: 'missing', sessionId: 's1', cause: 'not_found' },
            sessionPresent: false,
        })).toBeNull();
    });

    it.each([
        'encrypted_access_pending',
        'recipient_encryption_setup_required',
        'encrypted_access_needs_repair',
        'encrypted_content_unavailable',
    ] as const)('blocks content for %s', (availability) => {
        expect(resolveSessionBlockedSurfaceState({
            authSurfaceState: null,
            sessionPresent: true,
            contentAvailability: availability,
        })).toEqual({ kind: 'content_blocked', availability });
    });

    it.each([
        ['ready', 'ready' as const],
        ['unknown', undefined],
    ])('does not block a %s Session', (_label, contentAvailability) => {
        expect(resolveSessionBlockedSurfaceState({
            authSurfaceState: null,
            sessionPresent: true,
            ...(contentAvailability ? { contentAvailability } : {}),
        })).toBeNull();
    });
});

describe('Session blocked surface presentation', () => {
    it('offers Account encryption setup regardless of who manages the Session', () => {
        const presentation = projectSessionBlockedSurfacePresentation(
            { kind: 'content_blocked', availability: 'recipient_encryption_setup_required' },
            { collaborationAvailable: false },
        );

        expect(presentation.action?.intent).toBe('account_encryption_setup');
        expect(presentation.testID).toBe('session-content-unavailable');
        expect(presentation.diagnosticCode).toBe('recipient_encryption_setup_required');
    });

    it('separates a local repair retry from asking a manager', () => {
        const presentation = projectSessionBlockedSurfacePresentation(
            { kind: 'content_blocked', availability: 'encrypted_access_needs_repair' },
            { collaborationAvailable: true },
        );

        expect(presentation.action?.intent).toBe('retry_session_hydration');
        expect(presentation.secondaryAction?.intent).toBe('open_session_access');
    });

    it('does not offer an access action a viewer cannot reach', () => {
        const presentation = projectSessionBlockedSurfacePresentation(
            { kind: 'content_blocked', availability: 'encrypted_access_pending' },
            { collaborationAvailable: false },
        );

        expect(presentation.action).toBeNull();
        expect(presentation.secondaryAction).toBeNull();
        expect(presentation.kind).not.toBe('loading');
    });

    it('presents removal as removed access rather than a deleted Session', () => {
        const presentation = projectSessionBlockedSurfacePresentation(
            { kind: 'access_denied' },
            { collaborationAvailable: true },
        );

        expect(presentation.testID).toBe('session-access-denied');
        expect(presentation.action).toBeNull();
        expect(presentation.title).toBe('Access removed');
    });
});

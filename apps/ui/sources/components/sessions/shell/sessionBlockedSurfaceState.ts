import type { SurfaceStateKind } from '@/components/ui/surfaces/SurfaceStateCard';
import type { IconName } from '@/components/ui/icons/Icon';
import type { SessionContentAvailability } from '@/sync/domains/session/encryptedContentAvailability';
import type { SessionRouteHydrationState } from '@/sync/domains/session/sessionRouteHydrationState';
import { t } from '@/text';

import type { SessionAuthSurfaceState } from './sessionAuthSurfaceState';

/** Every content availability that must replace the transcript with a settled explanation. */
export type BlockedSessionContentAvailability = Exclude<SessionContentAvailability, 'ready'>;

/**
 * The one precedence decision for a Session detail surface that must not render its transcript.
 *
 * Account recovery, route authorization and encrypted-content delivery are separate facts, and each
 * one has a different truthful answer; resolving them here keeps the shell from reinterpreting a
 * raw crypto or route failure on its own. `not_found` deliberately produces no blocked state: an
 * ambiguous missing Session keeps the existing unavailable presentation.
 */
export type SessionBlockedSurfaceState =
    | Readonly<{ kind: 'account_recovery'; auth: SessionAuthSurfaceState }>
    | Readonly<{ kind: 'access_denied' }>
    | Readonly<{ kind: 'content_blocked'; availability: BlockedSessionContentAvailability }>;

export function resolveSessionBlockedSurfaceState(params: Readonly<{
    /** Already resolved by the one auth surface owner, so precedence has a single input. */
    authSurfaceState: SessionAuthSurfaceState | null;
    routeHydrationState?: SessionRouteHydrationState | null;
    sessionPresent: boolean;
    contentAvailability?: SessionContentAvailability | null;
}>): SessionBlockedSurfaceState | null {
    const routeMissing = params.routeHydrationState?.kind === 'missing'
        ? params.routeHydrationState
        : null;

    // Account recovery outranks everything else: without usable credentials no other answer can be
    // trusted, and the route cause has already been narrowed to the authentication ones.
    if (params.authSurfaceState && (!params.sessionPresent || routeMissing)) {
        return { kind: 'account_recovery', auth: params.authSurfaceState };
    }

    // An explicit denial is authoritative even while a previously cached Session is still in the
    // store; the cached row must never keep content reachable after access was removed.
    if (routeMissing?.cause === 'forbidden') {
        return { kind: 'access_denied' };
    }

    const availability = params.contentAvailability ?? null;
    if (params.sessionPresent && availability !== null && availability !== 'ready') {
        return { kind: 'content_blocked', availability };
    }
    return null;
}

/** What the person can actually do next; the shell owns how each intent is performed. */
export type SessionBlockedSurfaceActionIntent =
    | 'account_encryption_setup'
    | 'retry_session_hydration'
    | 'open_session_access';

export type SessionBlockedSurfaceAction = Readonly<{
    intent: SessionBlockedSurfaceActionIntent;
    label: string;
}>;

export type SessionBlockedSurfacePresentation = Readonly<{
    testID: string;
    kind: SurfaceStateKind;
    iconName: IconName;
    title: string;
    reason: string;
    /** Raw state for QA/diagnostics only — never rendered or announced. */
    diagnosticCode: string;
    action: SessionBlockedSurfaceAction | null;
    secondaryAction: SessionBlockedSurfaceAction | null;
}>;

function resolveOpenAccessAction(collaborationAvailable: boolean): SessionBlockedSurfaceAction | null {
    return collaborationAvailable
        ? { intent: 'open_session_access', label: t('session.access.openAccessAction') }
        : null;
}

/**
 * Copy for a settled state. Every case names what happened, what still has to happen and who can
 * do it, so no case can leave the person on an activity indicator waiting for nothing.
 */
export function projectSessionBlockedSurfacePresentation(
    state: Exclude<SessionBlockedSurfaceState, { kind: 'account_recovery' }>,
    options: Readonly<{ collaborationAvailable: boolean }>,
): SessionBlockedSurfacePresentation {
    if (state.kind === 'access_denied') {
        return {
            testID: 'session-access-denied',
            kind: 'unavailable',
            iconName: 'user-minus',
            title: t('session.access.removedTitle'),
            reason: t('session.access.removedBody'),
            diagnosticCode: 'session_access_denied',
            action: null,
            secondaryAction: null,
        };
    }

    const openAccess = resolveOpenAccessAction(options.collaborationAvailable);
    const base = {
        testID: 'session-content-unavailable',
        diagnosticCode: state.availability,
    } as const;

    switch (state.availability) {
        case 'encrypted_access_pending':
            return {
                ...base,
                kind: 'unavailable',
                iconName: 'key',
                title: t('session.access.pending'),
                reason: t('session.access.pendingBody'),
                action: openAccess,
                secondaryAction: null,
            };
        case 'recipient_encryption_setup_required':
            return {
                ...base,
                kind: 'warning',
                iconName: 'key',
                title: t('session.access.setup'),
                reason: t('session.access.setupBody'),
                action: {
                    intent: 'account_encryption_setup',
                    label: t('session.access.setupAction'),
                },
                secondaryAction: null,
            };
        case 'encrypted_access_needs_repair':
            return {
                ...base,
                kind: 'warning',
                iconName: 'key',
                title: t('session.access.repair'),
                reason: t('session.access.repairBody'),
                action: {
                    intent: 'retry_session_hydration',
                    label: t('session.access.retryAction'),
                },
                secondaryAction: openAccess,
            };
        case 'encrypted_content_unavailable':
            return {
                ...base,
                kind: 'unavailable',
                iconName: 'lock',
                title: t('session.access.unavailable'),
                reason: t('session.access.unavailableBody'),
                action: openAccess,
                secondaryAction: null,
            };
    }
}
